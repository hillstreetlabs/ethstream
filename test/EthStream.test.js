import Ganache from "ganache-core";
import Eth from "ethjs";
import EthStream from "../src/EthStream";
import mineSingleBlock from "./util/mineSingleBlock";
import { randomBlockHash } from "./util/crypto";

let web3Provider, eth, mineBlock;

beforeEach(() => {
  web3Provider = Ganache.provider();
  eth = new Eth(web3Provider);
  mineBlock = () => mineSingleBlock(web3Provider);
});

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
      fromBlockHash: randomBlockHash(),
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
      fromSnapshot: [
        { hash: randomBlockHash(), number: 1, parentHash: randomBlockHash() }
      ]
    });
    expect(stream.blocks.size).toEqual(1);
  });

  test("does not call addBlock with fromSnapshot", () => {
    const addedBlocks = [];
    const stream = new EthStream(web3Provider, {
      fromSnapshot: [
        { hash: randomBlockHash(), number: 1, parentHash: randomBlockHash() }
      ],
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
    await stream.addBlock({
      hash: "foo",
      number: 1,
      parentHash: randomBlockHash()
    });
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

  test("fails to add block with invalid parent hash", async () => {
    const fromBlock = await mineBlock();
    await stream.addBlock(fromBlock);
    await expect(
      stream.addBlock({
        hash: randomBlockHash(),
        number: parseInt(fromBlock.number) + 1,
        parentHash: randomBlockHash()
      })
    ).rejects.toThrow();

    expect(addedBlocks).toEqual([fromBlock.hash]);
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
        {
          hash: randomBlockHash(),
          number: parseInt(fromBlock.number),
          parentHash: randomBlockHash()
        }
      ]
    });
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([fromBlock.hash, newBlock.hash]);
  });
});
