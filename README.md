### ethstream

Bare-bones block watcher for Ethereum, letting you handle reorgs by just implementing a `onRollbackBlock` handler.

For a visual demonstration of what Ethstream is doing under the hood, check out
https://ethstream.hillstreetlabs.com.

#### Example
```typescript
import EthStream from "ethstream";
import HttpProvider from "ethjs-provider-http";

interface Block {
  hash: string,
  parentHash: string,
  number: number,
  logsBloom: string
};

const stream = new EthStream(new HttpProvider("https://mainnet.infura.io"), {
  onAddBlock: (block: Block) => { ... },
  onConfirmBlock: (block: Block) => { ... },
  onRollbackBlock: (block: Block) => { ... },
  fromBlockNumber: 5591867, // Can also use fromBlockHash: "..."
  numConfirmations: 6 // Number of children blocks needed to confirm a block
});

stream.start(); // Start streamin'

stream.stop(); // Stop streamin'

const snapshot = stream.takeSnapshot(); // Take snapshot for later

const anotherStream = new EthStream(new HttpProvider("https://mainnet.infura.io"), {
  fromSnapshot: snapshot
});
```

#### How does it work?

Ethstream works by repeatedly querying the `"latest"` block, and then trying to place that block into a block tree. If we haven't seen the new block's parent, the parent is added to the tree first.

When a block is successfully added to the tree, the `onAddBlock` callback is triggered. As new children blocks are added, the "depth" of each old block is tracked. When a block's depth reaches `numConfirmations`, the `onConfirmBlock` callback is triggered. If a block falls behind, meaning that it at least one sibling block with a depth of `numConfirmations`, that block is cleaned up, and `onRollbackBlock` is called.

This allows you to write clear services that neatly deal with complicated blockchain reorganizations.

#### Note

We recommend only using Ethstream to fetch the last ~20 blocks or so--most of its usefulness comes at the head of the chain. If you want to get logs older than 20 blocks, use `eth_getLogs` to fetch logs up to `currentBlock - 20` and then start Ethstream with `fromBlockNumber: currentBlock - 19`.
