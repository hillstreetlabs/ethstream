import Eth from "ethjs";
import BN from "bn.js";
import { action, computed, when, observable, runInAction, observe } from "mobx";
import withTimeout from "./util/withTimeout";

const CHILDREN_DEPTH_TO_CONFIRM = 4;
const DEPTH_TO_FLUSH = 6;
const NULL_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_WATCH_DELAY = 5000;

class Block {
  @observable childrenDepth = 0;

  constructor(history, data) {
    this.history = history;
    this.number = data.number.toNumber();
    this.hash = data.hash;
    this.parentHash = data.parentHash;
    // Set childrenDepth
    this.childrenDepth = observable.box(data.childrenDepth || 0);
    // Confirm block when childrenDepth changes
    this.confirmDisposer = observe(this, "childrenDepth", change => {
      if (change.newValue === CHILDREN_DEPTH_TO_CONFIRM) {
        this.history.confirmBlock(this.hash);
        this.confirmDisposer(); // Unsubscribe
      }
    });
    // Flush block when depth changes
    when(() => this.isFlushable, () => this.history.flushBlock(this.hash));
  }

  @action
  setChildrenDepth(newDepth) {
    this.childrenDepth = newDepth;
    if (this.parent) this.parent.setChildrenDepth(this.childrenDepth + 1);
  }

  @computed
  get isConfirmed() {
    return this.childrenDepth >= CHILDREN_DEPTH_TO_CONFIRM;
  }

  @computed
  get isFlushable() {
    // Make sure not to flush blocks before their parents are flushed
    return this.depth >= DEPTH_TO_FLUSH && !this.parent;
  }

  @computed
  get blocksToFlush() {
    return DEPTH_TO_FLUSH - this.depth;
  }

  @computed
  get parent() {
    return this.history.blocks.get(this.parentHash);
  }

  @computed
  get depth() {
    return this.history.headBlockNumber - this.number;
  }

  toSnapshot() {
    return {
      number: this.number.toString(),
      hash: this.hash.toString(),
      parentHash: this.parentHash.toString(),
      childrenDepth: this.childrenDepth
    };
  }

  toString() {
    return `Number: ${this.number}\tHash: ${this.hash.substring(
      0,
      8
    )}\tChildren Depth: ${this.childrenDepth}`;
  }
}

Block.fromSnapshot = (history, block) => {
  return new Block(history, {
    number: new BN(block.number),
    hash: block.hash,
    parentHash: block.parentHash,
    childrenDepth: parseInt(block.childrenDepth)
  });
};

export default Block;
