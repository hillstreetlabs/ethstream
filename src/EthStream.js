import Eth from "ethjs";
import BN from "bn.js";
import { action, computed, when, observable, runInAction, observe } from "mobx";
import Block from "./Block";
import withTimeout from "./util/withTimeout";

const NULL_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_DELAY = 2000;

export default class EthStream {
  @observable headBlockNumber = 0;

  constructor(jsonRpcUrl, props = {}) {
    this.eth = new Eth(new Eth.HttpProvider(jsonRpcUrl));
    this.onAddBlock = props.onAddBlock || (() => true);
    this.onConfirmBlock = props.onConfirmBlock || (() => true);
    this.onRollbackBlock = props.onRollbackBlock || (() => true);

    // Optionally fill from snapshot
    if (props.fromSnapshot) {
      this.blocks = observable(
        new Map(
          props.fromSnapshot.map(block => [
            block.hash,
            Block.fromSnapshot(this, block)
          ])
        )
      );
    } else {
      this.blocks = observable(new Map());
    }

    // Add origin block if passed to constructor
    if (props.fromBlock) this.addBlock(props.fromBlock);
  }

  @computed
  get isEmpty() {
    return this.blocks.size === 0;
  }

  takeSnapshot() {
    const snapshot = [];
    this.blocks.forEach(block => snapshot.push(block.toSnapshot()));
    return snapshot;
  }

  async getLatestBlock(delay = DEFAULT_DELAY) {
    try {
      const latestBlock = await withTimeout(
        this.eth.getBlockByNumber("latest", true),
        2000
      );
      const addedBlock = await this.addBlock(latestBlock);
      if (addedBlock) {
        console.log("CURRENT BLOCK HISTORY:");
        this.blocks.forEach(block => console.log(block.toString()));
      }
    } catch (err) {
      // TODO
      console.log("Error", err);
    }
    this.timer = setTimeout(() => this.getLatestBlock(delay), delay);
  }

  start() {
    this.getLatestBlock();
  }

  stop() {
    clearTimeout(this.timer);
  }

  @action
  confirmBlock(hash) {
    this.onConfirmBlock(this.blocks.get(hash));
  }

  @action
  flushBlock(hash) {
    const flushBlock = this.blocks.get(hash);
    if (!flushBlock.isConfirmed) {
      this.onRollbackBlock(flushBlock);
    }
    this.blocks.delete(hash);
  }

  @action
  async addBlock(block) {
    // Return if block isn't complete
    if (!block || !block.hash || !block.number || !block.parentHash)
      return false;
    // Return if block already in history
    if (this.blocks.has(block.hash)) return false;
    // Check for parent
    if (
      !this.isEmpty &&
      block.parentHash != NULL_HASH &&
      !this.blocks.has(block.parentHash)
    ) {
      const parentBlock = await this.eth.getBlockByHash(block.parentHash, true);
      console.log("Adding parent", parentBlock.number.toString());
      await this.addBlock(parentBlock);
    }
    // Add block
    console.log("Adding block", block.number.toString(), block.hash);
    const newBlock = new Block(this, block);
    this.blocks.set(block.hash, newBlock);
    this.onAddBlock(newBlock);
    // Re-count depths
    newBlock.setChildrenDepth(0);
    // Update headBlockNumber
    const blockNumber = block.number.toNumber();
    if (blockNumber > this.headBlockNumber) {
      this.headBlockNumber = blockNumber;
    }
    return newBlock;
  }
}
