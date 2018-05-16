### ethstream

Bare-bones block watcher for Ethereum.

#### Example
```
import EthStream from "ethstream";
import HttpProvider from "ethjs-provider-http";

const stream = new EthStream(new HttpProvider("https://mainnet.infura.io"), {
  onAddBlock: block => { ... },
  onConfirmBlock: block => { ... },
  onRollbackBlock: block => { ... },
  fromBlockNumber: 5591867, // Can also use fromBlockHash: "..."
  numConfirmations: 4 // Number of children blocks needed to confirm a block
});

stream.start(); // Start streamin'

stream.stop(); // Stop streamin'

const snapshot = stream.takeSnapshot(); // Take snapshot for later

const anotherStream = new EthStream(new HttpProvider("https://mainnet.infura.io"), {
  fromSnapshot: snapshot
});
```
