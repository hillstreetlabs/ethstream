### ethstream

Bare-bones block watcher for Ethereum.

#### Example
```
import EthStream from "ethstream";

const stream = new EthStream("https://mainnet.infura.io", {
  onAddBlock: block => this.importBlock(block),
  onConfirmBlock: block => this.confirmBlock(block),
  onRollbackBlock: block => this.rollbackBlock(block),
  fromSnapshot: [ ... ],
  fromBlock: { ... }
});

stream.start(); // Start streamin'

stream.stop();

const snapshot = stream.takeSnapshot(); // Take snapshot for later
```
