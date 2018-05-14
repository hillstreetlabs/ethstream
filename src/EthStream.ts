import Eth from "ethjs-query";
// import { action, computed, when, observable, observe } from "mobx";
import EthjsHttpProvider from "ethjs-provider-http";
import withTimeout from "./util/withTimeout";

class Block {
  hash: string;
  parentHash: string;
  number: number;
  childDepth?: number;
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
}

const BLOCK_CHAIN_LENGTH = 10;
const DEPTH_TO_ROLLBACK = 5;
const DEFAULT_DELAY = 1000;

// const NULL_HASH =
//   "0x0000000000000000000000000000000000000000000000000000000000000000";
// const DEFAULT_DELAY = 2000;

export default class EthStream {
  eth: Eth;
  blocksToAdd: Block[];
  addedBlocksByHash: Map<string, Block> = new Map();

  constructor(provider: EthjsHttpProvider, props: IEthStreamProps = {}) {
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
    this.eth = new Eth(provider);
    this.onAddBlock = props.onAddBlock || (() => true);
    this.onConfirmBlock = props.onConfirmBlock || (() => true);
    this.onRollbackBlock = props.onRollbackBlock || (() => true);
    this.fromBlockHash = props.fromBlockHash;
    this.fromBlockNumber = props.fromBlockNumber;
    this.fromBlockLoaded = false;
    // Start from snapshot
    if (props.fromSnapshot) {
      this.restoreFromSnapshot(props.fromSnapshot);
    } else {
      let fromBlock;
      if (props.fromBlockHash) {
        fromBlock = await this.eth.getBlockByHash(props.fromBlockHash);
      } else if (props.fromBlockNumber) {
        fromBlock = await this.eth.getBlockByNumber(props.fromBlockNumber);
      }
      this.insertBlock({
        hash: fromBlock.hash,
        number: fromBlock.number.toNumber(),
        parentHash: fromBlock.parentHash
      });
    }
  }

  async getLatestBlock(delay = DEFAULT_DELAY) {
    try {
      const latestBlock = await withTimeout(
        this.eth.getBlockByNumber("latest", true),
        2000
      );
      this.addBlock({
        hash: latestBlock.hash,
        parentHash: latestBlock.parentHash,
        number: latestBlock.number.toNumber(),
        childDepth: 0
      });
    } catch (err) {
      console.log("ERROR", err);
      // Silence getBlockByNumber errors
    }
    this.timer = setTimeout(() => this.getLatestBlock(delay), delay);
  }

  addBlock(block: Block) {
    // Don't add the same block multiple times
    if (this.blocksToAdd.some(block => block.hash === block.hash)) return;
    this.blocksToAdd.push(block);
    this.blocksToAdd.sort((block1, block2) => block1.number - block2.number);
    console.log(this.blocksToAdd);
  }

  getSnapshot(): Snapshot {
    return Array.from(this.addedBlocksByHash.values()).map(block => ({
      ...block,
      childDepth: block.childDepth || 0
    }));
  }

  private async getBlockByHash(hash: string): Promise<Block> {
    const ethBlock = await this.eth.getBlockByHash(hash, false);
    return {
      hash: ethBlock.hash,
      number: ethBlock.number.toNumber(),
      parentHash: ethBlock.parentHash,
      childDepth: 0
    };
  }

  private flushFlushableBlocks() {
    const blocks = Array.from(this.addedBlocksByHash.values());
    let maxBlockNumber = 0;
    for (let block of blocks) {
      if (block.number > maxBlockNumber) {
        maxBlockNumber = block.number;
      }
    }
    const blockNumberToFlush = maxBlockNumber - BLOCK_CHAIN_LENGTH;
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

  private run() {
    while (this.blocksToAdd.length > 0) {
      const block = this.blocksToAdd.pop();

      // Make sure we don't add the same block twice
      if (this.addedBlocksByHash.get(block.hash)) continue;

      const parent = this.addedBlocksByHash.get(block.parentHash);
      if (parent) {
        this.insertBlock(block);
      } else {
        // We don't have the parent, add the parent to the priority set
        this.addBlock(block);
        this.getBlockByHash(block.parentHash).then(parent => {
          this.addBlock(parent);
        });
      }
    }
  }

  private insertBlock(block: Block) {
    // We're ready to insert a leaf block into the tree. Insert it and update
    // childDepths

    block.childDepth = 0;
    this.addedBlocksByHash.set(block.hash, block);
    let parent = this.addedBlocksByHash.get(block.parentHash);
    let childDepth = 1;
    while (parent && parent.childDepth < childDepth) {
      parent.childDepth = childDepth;
      childDepth++;
      parent = this.addedBlocksByHash.get(parent.parentHash);
    }

    this.flushFlushableBlocks();
  }

  restoreFromSnapshot(snapshot: Snapshot) {
    snapshot.forEach(block => {
      this.addedBlocksByHash.set(block.hash, block);
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
