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

  test("fails when numConfirmations > streamSize", () => {
    const props = {
      numConfirmations: 4,
      streamSize: 3
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });
});

describe("addBlock", () => {
  // For sharing variables
  let addedBlocks, confirmedBlocks, removedBlocks, stream;

  beforeEach(() => {
    addedBlocks = [];
    confirmedBlocks = [];
    removedBlocks = [];
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      onConfirmBlock: block => confirmedBlocks.push(block.hash),
      onRollbackBlock: block => removedBlocks.push(block.hash),
      numConfirmations: 2,
      streamSize: 3
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

  test("adds new block that is older than fromBlockHash", async () => {
    await mineBlock();
    const fromBlock = await mineBlock();
    stream = new EthStream(web3Provider, {
      onAddBlock: block => addedBlocks.push(block.hash),
      fromBlockHash: fromBlock.hash
    });
    const newBlock = {
      hash: randomBlockHash(),
      number: parseInt(fromBlock.number) - 1,
      parentHash: randomBlockHash()
    };
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([fromBlock.hash, newBlock.hash]);
  });

  test("adds new blocks asynchronously", async () => {
    const fromBlock = await mineBlock();
    await stream.addBlock(fromBlock);
    const parentBlock1 = await mineBlock();
    const parentBlock2 = await mineBlock();
    const newBlock = await mineBlock();
    await Promise.all([stream.addBlock(newBlock), stream.addBlock(newBlock)]);
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock1.hash,
      parentBlock2.hash,
      newBlock.hash
    ]);
  });

  test("confirms parent block", async () => {
    const fromBlock = await mineBlock();
    await stream.addBlock(fromBlock);
    await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(confirmedBlocks).toEqual([fromBlock.hash]);
  });

  test("confirms parent blocks in order", async () => {
    const confirmBlock1 = await mineBlock();
    await stream.addBlock(confirmBlock1);
    const confirmBlock2 = await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(confirmedBlocks).toEqual([confirmBlock1.hash, confirmBlock2.hash]);
  });

  test("removes uncle block", async () => {
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: randomBlockHash()
    };
    await stream.addBlock(uncleBlock);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(newBlock);
    expect(removedBlocks).toEqual([uncleBlock.hash]);
  });

  test("removes uncle blocks in order", async () => {
    await mineBlock();
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock1 = {
      number: parseInt(newBlock.number) - 4,
      hash: randomBlockHash(),
      parentHash: randomBlockHash()
    };
    const uncleBlock2 = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: uncleBlock1.hash
    };
    await stream.addBlock(uncleBlock1);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(uncleBlock2);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(newBlock);
    expect(removedBlocks).toEqual([uncleBlock1.hash, uncleBlock2.hash]);
  });

  xtest("removes uncle block once when adding blocks asynchronously", async () => {
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: randomBlockHash()
    };
    await stream.addBlock(uncleBlock);
    await Promise.all([stream.addBlock(newBlock), stream.addBlock(newBlock)]);
    console.log("addedBlocks", addedBlocks);
    console.log("confirmedBlocks", confirmedBlocks);
    expect(removedBlocks).toEqual([uncleBlock.hash]);
  });
});
