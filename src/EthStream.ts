import Web3 from "web3";
import { HttpProvider, BlockType, Block as Web3Block } from "web3/types";
import withTimeout from "./util/withTimeout";

class Block {
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
  onAddBlock?: (block: Block) => void;
  onRollbackBlock?: (block: Block) => void;
  onConfirmBlock?: (block: Block) => void;
}

const BLOCK_CHAIN_LENGTH = 10;
const DEPTH_TO_FLUSH = BLOCK_CHAIN_LENGTH + 2;
const DEPTH_TO_ROLLBACK = 5;
const DEFAULT_DELAY = 1000;
const DEPTH_TO_CONFIRM = 5;

// const NULL_HASH =
//   "0x0000000000000000000000000000000000000000000000000000000000000000";
// const DEFAULT_DELAY = 2000;

export default class EthStream {
  web3: Web3;
  blocksToAdd: Block[] = [];
  addedBlocksByHash: Map<string, Block> = new Map();
  maxBlockNumber = 0;

  onAddBlock: (block: Block) => void;
  onRollbackBlock: (block: Block) => void;
  onConfirmBlock: (block: Block) => void;

  timer: any;
  isStopped: boolean;
  isRunning: boolean;
  isAddingOldBlocks: boolean;

  constructor(provider: HttpProvider, props: IEthStreamProps = {}) {
    // Check jsonRpcUrl
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
    this.web3 = new Web3(provider);
    this.onAddBlock = props.onAddBlock || (() => true);
    this.onConfirmBlock = props.onConfirmBlock || (() => true);
    this.onRollbackBlock = props.onRollbackBlock || (() => true);

    this.fetchFirstBlock(props);
  }

  start() {
    console.log("STARTING");
    this.isStopped = false;
    this.getLatestBlock();
  }

  stop() {
    this.isStopped = true;
    clearTimeout(this.timer);
  }

  async fetchFirstBlock(props: IEthStreamProps) {
    // Start from snapshot
    if (props.fromSnapshot) {
      this.restoreFromSnapshot(props.fromSnapshot);
    } else {
      let fromBlock;
      console.log("WE HERE");
      if (props.fromBlockHash) {
        fromBlock = await this.web3.eth.getBlock(
          props.fromBlockHash as BlockType
        );
      } else if (props.fromBlockNumber) {
        fromBlock = await this.web3.eth.getBlock(props.fromBlockNumber);
      }
      console.log("WE GOT A BLOCK", fromBlock);
      this.insertBlock(Block.fromBlock(fromBlock));
    }
  }

  async getLatestBlock(delay = DEFAULT_DELAY) {
    try {
      const latestBlock = await withTimeout(
        this.web3.eth.getBlock("latest"),
        2000
      );
      console.log("Got a new block, adding it");

      this.addBlock(Block.fromBlock(latestBlock));
    } catch (err) {
      console.log("ERROR", err);
      // Silence getBlockByNumber errors
    }
    this.timer = setTimeout(() => this.getLatestBlock(delay), delay);
  }

  async addOldBlocks() {
    if (this.isStopped || this.isAddingOldBlocks) return;
    this.isAddingOldBlocks = true;
    // This is a special function that is run if the fromBlock is too far behind
    // eth_blockNumber
    let blocks;

    try {
      const currentBlockNumber = await this.web3.eth.getBlockNumber();
      let oldBlockNumber = this.maxBlockNumber + 1;
      const promises = [];
      while (
        oldBlockNumber < currentBlockNumber - BLOCK_CHAIN_LENGTH &&
        oldBlockNumber - this.maxBlockNumber < 100
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

  addBlock(block: Block) {
    // Don't add the same block multiple times
    if (this.addedBlocksByHash.has(block.hash)) return;
    if (this.blocksToAdd.some(bl => bl.hash === block.hash)) return;
    this.blocksToAdd.push(block);
    this.blocksToAdd.sort((block1, block2) => block1.number - block2.number);

    // Start a run
    this.run();
  }

  takeSnapshot(): Snapshot {
    return Array.from(this.addedBlocksByHash.values()).map(block => ({
      ...block,
      childDepth: block.childDepth || 0
    }));
  }

  private async getBlockByHash(hash: string): Promise<Block> {
    const block = await this.web3.eth.getBlock(hash as BlockType);
    return Block.fromBlock(block);
  }

  private flushFlushableBlocks() {
    const blocks = Array.from(this.addedBlocksByHash.values());
    let maxBlockNumber = 0;
    for (let block of blocks) {
      if (block.number > maxBlockNumber) {
        maxBlockNumber = block.number;
      }
    }
    const blockNumberToFlush = maxBlockNumber - DEPTH_TO_FLUSH;
    const blockNumberToRollback = maxBlockNumber - DEPTH_TO_ROLLBACK;
    for (let block of blocks) {
      if (block.number < blockNumberToFlush) {
        this.addedBlocksByHash.delete(block.hash);
        // Notify of flushed block
      }
      if (block.number + block.childDepth < blockNumberToRollback) {
        this.addedBlocksByHash.delete(block.hash);
      }
    }
  }

  private async run() {
    console.log("Trying to run with ", this.blocksToAdd.map(b => b.number));
    if (this.isRunning) return;
    this.isRunning = true;

    const currentBlockNumber = await this.web3.eth.getBlockNumber();
    if (currentBlockNumber > this.maxBlockNumber + BLOCK_CHAIN_LENGTH) {
      // Add old blocks before going on

      this.isRunning = false;
      await this.addOldBlocks();
      this.run();
      return;
    }

    while (this.blocksToAdd.length > 0) {
      const block = this.blocksToAdd.pop();

      // Make sure we don't add the same block twice
      if (this.addedBlocksByHash.get(block.hash)) continue;

      const parent = this.addedBlocksByHash.get(block.parentHash);
      if (parent) {
        this.insertBlock(block);
      } else {
        // We don't have the parent, add the parent to the priority set
        console.log("trying to add parent");
        this.getBlockByHash(block.parentHash).then(parent => {
          console.log("Adding parent", parent.number, parent.hash);
          this.addBlock(parent);
          this.addBlock(block);
        });
      }
    }
    this.isRunning = false;
  }

  private insertBlock(block: Block) {
    // We're ready to insert a leaf block into the tree. Insert it and update
    // childDepths

    this.onAddBlock(block);
    if (block.number > this.maxBlockNumber) this.maxBlockNumber = block.number;
    block.childDepth = 0;
    this.addedBlocksByHash.set(block.hash, block);
    let parent = this.addedBlocksByHash.get(block.parentHash);
    let childDepth = 1;
    while (parent && parent.childDepth < childDepth) {
      if (parent.childDepth < childDepth && childDepth === DEPTH_TO_CONFIRM)
        this.onConfirmBlock(parent);
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
