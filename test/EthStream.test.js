import Ganache from "ganache-core";
import Eth from "ethjs";
import EthStream from "../src/EthStream";
import mineSingleBlock from "./util/mineSingleBlock";

const web3Provider = Ganache.provider();
const eth = new Eth(web3Provider);

const mineBlock = () => mineSingleBlock(web3Provider);

describe("constructor", () => {
  test("succeeds with valid provider", () => {
    expect(() => new EthStream(web3Provider)).toBeTruthy();
  });

  test("fails without a provider", () => {
    expect(() => new EthStream(null)).toThrow();
  });

  test("fails with a host URL", () => {
    expect(() => new EthStream("http://localhost:8545")).toThrow();
  });

  test("fails with fromBlockHash and fromBlockNumber props", () => {
    const props = {
      fromBlockHash:
        "0xf199d42f0bf6e68ada9a2a3dbf4a59b48ae6758fa3e1250fdb4408de88c71c1d",
      fromBlockNumber: 5596897
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });

  test("fails with fromSnapshot and fromBlockNumber", () => {
    const props = {
      fromBlockNumber: 5596897,
      fromSnapshot: [{}]
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });

  test("succeeds with fromSnapshot", () => {
    const stream = new EthStream(web3Provider, {
      fromSnapshot: [{ hash: "foo", number: 1, parentHash: "bar" }]
    });
    expect(stream.blocks.size).toEqual(1);
  });

  test("does not call addBlock with fromSnapshot", () => {
    const addedBlocks = [];
    const stream = new EthStream(web3Provider, {
      fromSnapshot: [{ hash: "foo", number: 1, parentHash: "bar" }],
      onAddBlock: block => addedBlocks.push(block)
    });
    expect(addedBlocks).toEqual([]);
  });
});

describe("addBlock", () => {
  // For sharing variables
  let addedBlocks, stream;

  beforeEach(() => {
    addedBlocks = [];
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash)
    });
  });

  test("adds a new block", async () => {
    await stream.addBlock({ hash: "foo", number: 1, parentHash: "bar" });
    expect(addedBlocks).toEqual(["foo"]);
  });

  test("adds a new block by mining", async () => {
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([newBlock.hash]);
  });

  test("adds parent blocks before child", async () => {
    const rootBlock = await mineBlock();
    await stream.addBlock(rootBlock);
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([
      rootBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  test("adds new block and backfills to fromBlockNumber", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      fromBlockNumber: parseInt(fromBlock.number)
    });
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  test("adds new block and backfills to fromBlockHash", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      fromBlockHash: fromBlock.hash
    });
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  test("adds new block and backfills to fromSnapshot", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      fromSnapshot: [fromBlock]
    });
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([parentBlock.hash, newBlock.hash]);
  });

  test("adds new block and backfills to blockNumber of fromSnapshot", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      fromSnapshot: [
        { hash: "foo", number: parseInt(fromBlock.number), parentHash: "bar" }
      ]
    });
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([fromBlock.hash, newBlock.hash]);
  });
});
