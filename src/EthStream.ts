import Web3 from "web3";
import { HttpProvider, BlockType, Block as Web3Block } from "web3/types";
import withTimeout from "./util/withTimeout";
import EventEmitter from "./EventEmitter";

export class Block {
  hash: string;
  parentHash: string;
  number: number;
  childDepth?: number;

  static fromBlock(block: Web3Block) {
    const newBlock = new Block();
    newBlock.childDepth = 0;
    newBlock.hash = block.hash;
    newBlock.number = parseInt(block.number.toFixed());
    newBlock.parentHash = block.parentHash;
    return newBlock;
  }
}

interface IBlockSnapshot {
  hash: string;
  parentHash: string;
  number: number;
  childDepth: number;
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
const DEPTH_TO_ROLLBACK = 5;
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
  maxBackfills = this.streamSize + 1;

  onAddBlock: (block: Block) => void;
  onRollbackBlock: (block: Block) => void;
  onConfirmBlock: (block: Block) => void;

  onReady: () => void;

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
    console.log("Starting");
    this.isStopped = false;
    this.getLatestBlock();
  }

  stop() {
    this.isStopped = true;
    clearTimeout(this.timer);
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
      console.log("Restoring");
      this.restoreFromSnapshot(props.fromSnapshot);
    } else {
      let fromBlock;
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
      this.insertBlock(Block.fromBlock(fromBlock));
    }
    console.log("EMitting");
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
      console.log("ERROR", err);
      // Silence getBlockByNumber errors
    }
    this.timer = setTimeout(() => this.getLatestBlock(delay), delay);
  }

  async addOldBlocks() {
    // This is a special function that is run if the fromBlock is too far behind
    // eth_blockNumber

    // No-reentry
    if (this.isStopped || this.isAddingOldBlocks) return;
    this.isAddingOldBlocks = true;

    // Try to get at most BATCH_SIZE blocks, stopping if we meet
    let blocks;
    try {
      const currentBlockNumber = await this.web3.eth.getBlockNumber();
      let oldBlockNumber = this.maxBlockNumber + 1;
      const promises = [];
      while (
        oldBlockNumber < currentBlockNumber - this.maxBackfills &&
        oldBlockNumber - this.maxBlockNumber < BATCH_SIZE
      ) {
        oldBlockNumber++;
        promises.push(
          this.web3.eth
            .getBlock(oldBlockNumber)
            .then(block => Block.fromBlock(block))
        );
      }
      blocks = await Promise.all(promises);
    } catch (e) {
      console.debug(
        "[Ethstream] There was a problem loading old blocks, trying again..."
      );
      this.isAddingOldBlocks = false;
      setTimeout(() => this.addOldBlocks(), 1000);
      return;
    }

    blocks.forEach(block => {
      this.insertBlock(block);
    });
    console.log("Done adding old blocks");
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

  private async run() {
    console.log("Trying to run with ", this.blocksToAdd.map(b => b.number));
    if (this.isRunning) return;
    this.isRunning = true;

    const currentBlockNumber = await this.web3.eth.getBlockNumber();
    if (currentBlockNumber > this.maxBlockNumber + this.maxBackfills) {
      // Add old blocks before going on
      this.isRunning = false;
      await this.addOldBlocks();
      this.run();
      return;
    }

    while (this.blocksToAdd.length > 0) {
      const block = this.blocksToAdd.shift();
      console.log("Trying to add block", block.number);

      // Make sure we don't add the same block twice
      if (this.addedBlocksByHash.get(block.hash)) continue;

      const parent = this.addedBlocksByHash.get(block.parentHash);
      if (parent) {
        this.insertBlock(block);

        // Check if we're up to date with the latest block
        if (this.blocksToAdd.length === 0) this.emit("live");
      } else {
        // We don't have the parent, try to backfill our way there
        console.log("trying to add parent of block", block.number);
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

  private insertBlock(block: Block) {
    // We're ready to insert a leaf block into the tree. Insert it and update
    // childDepths

    console.log("Inserting ", block.hash);
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
      if (
        parent.childDepth < childDepth &&
        childDepth === this.numConfirmations
      )
        this.emit("confirm", parent);
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

//   @computed
//   get isEmpty() {
//     return this.blocks.size === 0;
//   }

//   get fromBlockNeedsLoading() {
//     return (
//       (this.fromBlockHash || this.fromBlockNumber) && !this.fromBlockLoaded
//     );
//   }

//   async loadFromBlock() {
//     let fromBlock;
//     if (this.fromBlockHash) {
//       fromBlock = await this.eth.getBlockByHash(this.fromBlockHash, true);
//     }
//     if (this.fromBlockNumber) {
//       fromBlock = await this.eth.getBlockByNumber(this.fromBlockNumber, true);
//     }
//     this.fromBlockLoaded = true;
//     await this.addBlock(fromBlock);
//     return true;
//   }

//   takeSnapshot() {
//     const snapshot = [];
//     this.blocks.forEach(block => snapshot.push(block.toSnapshot()));
//     return snapshot;
//   }

//   async start() {
//     if (this.fromBlockNeedsLoading) await this.loadFromBlock();
//     this.getLatestBlock();
//   }

//   stop() {
//     clearTimeout(this.timer);
//   }

//   @action
//   confirmBlock(hash) {
//     this.onConfirmBlock(this.blocks.get(hash));
//   }

//   @action
//   flushBlock(hash) {
//     const flushBlock = this.blocks.get(hash);
//     if (!flushBlock.isConfirmed) {
//       this.onRollbackBlock(flushBlock);
//     }
//     this.blocks.delete(hash);
//   }

//   addBlock(block) {
//     // Return if block isn't complete
//     if (!block || !block.hash || !block.number || !block.parentHash)
//       return false;

//     this.history.addBlock(block);

//     // Check for fromBlock
//     if (this.fromBlockNeedsLoading) await this.loadFromBlock();
//     // Return if block already in history
//     if (this.blocks.has(block.hash)) return false;
//     // Check for parent
//     if (
//       !this.isEmpty &&
//       block.parentHash != NULL_HASH &&
//       !this.blocks.has(block.parentHash)
//     ) {
//       const parentBlock = await this.eth.getBlockByHash(block.parentHash, true);
//       await this.addBlock(parentBlock);
//     }
//     // Add block
//     const newBlock = new Block(this, block);
//     this.blocks.set(block.hash, newBlock);
//     this.onAddBlock(newBlock);
//     // Re-count depths
//     newBlock.setChildrenDepth(0);
//     // Update headBlockNumber
//     const blockNumber = block.number.toNumber();
//     if (blockNumber > this.headBlockNumber) {
//       this.headBlockNumber = blockNumber;
//     }
//     return newBlock;
//   }
// }
