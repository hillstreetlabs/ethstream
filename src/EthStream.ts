import Web3 from "web3";
import { HttpProvider, BlockType, Block as Web3Block } from "web3/types";
import withTimeout from "./util/withTimeout";
import EventEmitter from "./EventEmitter";

export class Block {
  hash: string;
  parentHash: string;
  number: number;
  logsBloom: string;
  childDepth?: number;

  static fromBlock(block: Web3Block) {
    const newBlock = new Block();
    newBlock.childDepth = 0;
    newBlock.hash = block.hash;
    newBlock.number = parseInt(block.number.toFixed());
    newBlock.parentHash = block.parentHash;
    newBlock.logsBloom = block.logsBloom;
    return newBlock;
  }
}

interface IBlockSnapshot {
  hash: string;
  parentHash: string;
  number: number;
  childDepth: number;
  logsBloom: string;
}

type Snapshot = IBlockSnapshot[];

interface IEthStreamProps {
  fromBlockHash?: string;
  fromBlockNumber?: number;
  fromSnapshot?: Snapshot;
  streamSize?: number;
  numConfirmations?: number;
  onReady?: () => void;
  onAddBlock?: (block: Block) => void;
  onRollbackBlock?: (block: Block) => void;
  onConfirmBlock?: (block: Block) => void;
}

const DEPTH_TO_FLUSH = 12;
const DEPTH_TO_CONFIRM = 5;
const DEFAULT_DELAY = 1000;
const BATCH_SIZE = 100;

export default class EthStream extends EventEmitter {
  web3: Web3;
  blocksToAdd: Block[] = [];
  addedBlocksByHash: Map<string, Block> = new Map();
  maxBlockNumber = 0;

  numConfirmations = DEPTH_TO_CONFIRM;
  streamSize = DEPTH_TO_FLUSH;
  maxBackfills = this.streamSize;

  timer: any;
  isStopped: boolean;
  isRunning: boolean;
  isAddingOldBlocks: boolean;

  blockAddedHandlers: { [hash: string]: Array<() => void> } = {};

  constructor(provider: HttpProvider, props: IEthStreamProps = {}) {
    super();

    // Check provider
    if (!provider)
      throw new Error(
        "web3 provider must be specified (e.g. `new EthStream(new HttpProvider('http://localhost:8545'), {})`)"
      );
    // Check fromBlockNumber, fromBlockHash, fromSnapshot props
    const fromPropsCount = [
      props.fromBlockHash,
      props.fromBlockNumber,
      props.fromSnapshot
    ].filter(Boolean).length;
    if (fromPropsCount > 1)
      throw new Error(
        "only one allowed: fromBlockHash, fromBlockNumber, fromSnapshot"
      );

    if (props.streamSize) {
      this.streamSize = props.streamSize;
      this.maxBackfills = this.streamSize;
      if (props.numConfirmations && props.numConfirmations >= this.streamSize) {
        throw new Error("numConfirmations must be less than streamSize");
      }
    }

    if (props.numConfirmations) this.numConfirmations = props.numConfirmations;

    this.web3 = new Web3(provider);
    if (props.onAddBlock) this.on("add", props.onAddBlock);
    if (props.onConfirmBlock) this.on("confirm", props.onConfirmBlock);
    if (props.onRollbackBlock) this.on("rollback", props.onRollbackBlock);

    this.fetchFirstBlock(props);
  }

  start() {
    this.isStopped = false;
    this.getLatestBlock();
  }

  stop() {
    this.isStopped = true;
  }

  safeTimeout(func: () => void, timeout: number) {
    setTimeout(() => {
      if (this.isStopped) return;
      func();
    }, timeout);
  }

  addBlock(web3Block: Web3Block) {
    const block = Block.fromBlock(web3Block);
    this.queueBlock(block);

    // Try a run if we're not running
    this.run();

    // Return a promise that resolves when this block gets added
    if (this.addedBlocksByHash.has(block.hash)) return Promise.resolve();
    return new Promise(resolve => {
      if (!this.blockAddedHandlers[block.hash])
        this.blockAddedHandlers[block.hash] = [];
      this.blockAddedHandlers[block.hash].push(resolve);
    });
  }

  async fetchFirstBlock(props: IEthStreamProps) {
    // Start from snapshot
    if (props.fromSnapshot) {
      this.restoreFromSnapshot(props.fromSnapshot);
    } else {
      let fromBlock;
      try {
        if (props.fromBlockHash) {
          fromBlock = await this.web3.eth.getBlock(
            props.fromBlockHash as BlockType
          );
        } else if (props.fromBlockNumber) {
          fromBlock = await this.web3.eth.getBlock(props.fromBlockNumber);
        } else {
          const currentBlockNumber = await this.web3.eth.getBlockNumber();
          fromBlock = await this.web3.eth.getBlock(
            Math.max(0, currentBlockNumber - this.streamSize)
          );
        }
      } catch (e) {
        // Try fetching the first block again in a few
        this.safeTimeout(() => this.fetchFirstBlock(props), 3000);
        return;
      }
      this.insertBlock(Block.fromBlock(fromBlock));
    }
    this.emit("ready");
  }

  async getLatestBlock(delay = DEFAULT_DELAY) {
    try {
      const latestBlock = await withTimeout(
        this.web3.eth.getBlock("latest"),
        2000
      );
      this.addBlock(latestBlock);
    } catch (err) {
      // Silence getBlockByNumber errors
    }
    this.safeTimeout(() => this.getLatestBlock(delay), delay);
  }

  async addOldBlocks() {
    // This is a special function that is run if the fromBlock is too far behind
    // eth_blockNumber

    // No-reentry
    if (this.isAddingOldBlocks) return;
    this.isAddingOldBlocks = true;

    // Try to get at most BATCH_SIZE blocks, stopping if we meet
    let blocks;
    try {
      const currentBlockNumber = await withTimeout(
        this.web3.eth.getBlockNumber(),
        2000
      );
      let blockNumber = this.maxBlockNumber + 1;
      const promises = [];
      while (
        blockNumber < currentBlockNumber - this.maxBackfills + 1 &&
        blockNumber - this.maxBlockNumber < BATCH_SIZE
      ) {
        promises.push(
          this.web3.eth
            .getBlock(blockNumber)
            .then(block => Block.fromBlock(block))
        );
        blockNumber++;
      }
      blocks = await withTimeout(Promise.all(promises), 5000);
    } catch (e) {
      console.debug(
        "[Ethstream] There was a problem loading old blocks, trying again..."
      );
      this.isAddingOldBlocks = false;
      this.safeTimeout(() => this.addOldBlocks(), 3000);
      return;
    }

    blocks.forEach(block => {
      this.insertBlock(block);
    });
    this.isAddingOldBlocks = false;
  }

  queueBlock(block: Block) {
    // Don't queue the same block multiple times
    if (this.addedBlocksByHash.has(block.hash)) return;
    if (this.blocksToAdd.some(bl => bl.hash === block.hash)) return;
    this.blocksToAdd.push(block);
    this.blocksToAdd.sort((block1, block2) => block1.number - block2.number);
  }

  takeSnapshot(): Snapshot {
    return Array.from(this.addedBlocksByHash.values()).map(block => ({
      ...block,
      childDepth: block.childDepth || 0
    }));
  }

  private async getBlockByHash(hash: string): Promise<Block> {
    try {
      const block = await this.web3.eth.getBlock(hash as BlockType);
      return Block.fromBlock(block);
    } catch (e) {
      this.emit("error", "Block with hash " + hash + " not found");
    }
  }

  private async run() {
    if (this.isRunning) return;
    this.isRunning = true;

    let currentBlockNumber;
    try {
      currentBlockNumber = await this.web3.eth.getBlockNumber();
    } catch (e) {
      // Try running again in a few
      this.isRunning = false;
      this.safeTimeout(() => this.run(), 3000);
      return;
    }

    if (currentBlockNumber > this.maxBlockNumber + this.maxBackfills) {
      // Add old blocks before going on
      this.isRunning = false;
      await this.addOldBlocks();
      this.run();
      return;
    }

    while (this.blocksToAdd.length > 0) {
      const block = this.blocksToAdd.shift();

      // Make sure we don't add the same block twice
      if (this.addedBlocksByHash.get(block.hash)) continue;

      const parent = this.addedBlocksByHash.get(block.parentHash);
      if (parent) {
        this.insertBlock(block);

        // Check if we're up to date with the latest block
        if (this.blocksToAdd.length === 0) this.emit("live");
      } else {
        // We don't have the parent, try to backfill our way there
        this.getBlockByHash(block.parentHash).then(parent => {
          if (!parent) return;
          this.queueBlock(parent);
          this.queueBlock(block);
          this.run();
        });
        break;
      }
    }
    this.isRunning = false;
  }

  private flushFlushableBlocks() {
    const blocks = Array.from(this.addedBlocksByHash.values());
    let maxBlockNumber = 0;
    for (let block of blocks) {
      if (block.number > maxBlockNumber) {
        maxBlockNumber = block.number;
      }
    }
    const depthToRollback = this.numConfirmations;
    const blockNumberToFlush = maxBlockNumber - this.streamSize;
    const blockNumberToRollback = maxBlockNumber - depthToRollback;
    for (let block of blocks) {
      if (
        block.number < blockNumberToFlush ||
        block.number + block.childDepth < blockNumberToRollback
      ) {
        this.addedBlocksByHash.delete(block.hash);
        if (block.childDepth < depthToRollback) {
          this.emit("rollback", block);
        }
      }
    }
  }

  private insertBlock(block: Block) {
    // We're ready to insert a leaf block into the tree. Insert it and update
    // childDepths

    this.emit("add", block);
    if (this.blockAddedHandlers[block.hash]) {
      // Resolve a promise
      this.blockAddedHandlers[block.hash].forEach(h => h());
      delete this.blockAddedHandlers[block.hash];
    }
    if (block.number > this.maxBlockNumber) this.maxBlockNumber = block.number;
    block.childDepth = 0;
    this.addedBlocksByHash.set(block.hash, block);
    let parent = this.addedBlocksByHash.get(block.parentHash);
    let childDepth = 1;
    while (parent && parent.childDepth < childDepth) {
      if (childDepth === this.numConfirmations) {
        // Parent now has numConfirmations children, lets confirm it
        this.emit("confirm", parent);
      }
      parent.childDepth = childDepth;
      childDepth++;
      parent = this.addedBlocksByHash.get(parent.parentHash);
    }

    this.flushFlushableBlocks();
  }

  restoreFromSnapshot(snapshot: Snapshot) {
    snapshot.forEach(block => {
      this.addedBlocksByHash.set(block.hash, block);
      if (block.number > this.maxBlockNumber)
        this.maxBlockNumber = block.number;
    });
  }
}
