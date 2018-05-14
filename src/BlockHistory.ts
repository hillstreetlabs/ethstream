// Block history takes a stream blocks and inserts them into a tree

// class PrioritySet<T> {
//   elements: T[] = [];
//   byId: Map<string, boolean> = new Map();

//   insert(id, rank, element) {
//     if (this.byId.get(id))
//       return;
//     byId.set(id) = true;

//   }
// }

const BLOCK_CHAIN_LENGTH = 10;
const DEPTH_TO_ROLLBACK = 5;

declare class PrioritySet<T> {
  insert(t: T): boolean;
  pop(): T;
  isEmpty(): boolean;
}

class Block {
  hash: string;
  number: number;
  parentHash: string;
  childDepth: number;
}

export default class BlockHistory {
  blocksToAdd: PrioritySet<Block>;
  addedBlocksByHash: Map<string, Block> = new Map();

  // The minimum block number we care about. Blocks before this will be flushed
  minBlockNumber: number;

  constructor(args: { onAddBlock: (block: Block) => void }) {
    const { onAddBlock } = args;
    console.log(onAddBlock);
  }

  addBlock(block: Block) {
    this.blocksToAdd.insert(block);
  }

  flushFlushableBlocks() {
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

  run() {
    while (!this.blocksToAdd.isEmpty()) {
      const block = this.blocksToAdd.pop();

      // Make sure we don't add the same block twice
      if (this.addedBlocksByHash.get(block.hash)) continue;

      const parent = this.addedBlocksByHash.get(block.parentHash);
      if (parent) {
        this.insertBlock(block);
      } else {
        // We don't have the parent, add the parent to the priority set
        this.addBlock(block);
        this.getBlockFromEth(block.parentHash).then(parent => {
          this.addBlock(parent);
        });
      }
    }
  }

  insertBlock(block: Block) {
    // We're ready to insert a leaf block into the tree. Insert it and update
    // childDepths

    this.addedBlocksByHash.set(block.hash, block);
    let parent = this.addedBlocksByHash.get(block.parentHash);
    let childDepth = 0;
    while (parent) {
      childDepth++;
      parent.childDepth = childDepth;
      parent = this.addedBlocksByHash.get(parent.parentHash);
    }

    this.flushFlushableBlocks();
  }

  getSnapshot() {
    return Array.from(this.addedBlocksByHash.values()).map(block => ({
      ...block
    }));
  }
}
