import Ganache from "ganache-core";
import Web3 from "web3";
import EthStream, { Block } from "../dist/EthStream";
import mineSingleBlock from "./util/mineSingleBlock";
import { randomBlockHash } from "./util/crypto";

let web3Provider, mineBlock;

function genesisBlock() {
  return new Web3(web3Provider).eth.getBlock("latest");
}

describe("constructor", () => {
  beforeEach(() => {
    web3Provider = Ganache.provider();
    mineBlock = () => mineSingleBlock(web3Provider);
  });

  it("succeeds with valid provider", () => {
    expect(() => new EthStream(web3Provider)).toBeTruthy();
  });

  it("fails without a provider", () => {
    expect(() => new EthStream(null)).toThrow();
  });

  it("fails with fromBlockHash and fromBlockNumber props", () => {
    const props = {
      fromBlockHash: randomBlockHash(),
      fromBlockNumber: 5596897
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });

  it("fails with fromSnapshot and fromBlockNumber", () => {
    const props = {
      fromBlockNumber: 5596897,
      fromSnapshot: [{}]
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });

  it("succeeds with fromSnapshot", () => {
    const stream = new EthStream(web3Provider, {
      fromSnapshot: [
        { hash: randomBlockHash(), number: 1, parentHash: randomBlockHash() }
      ]
    });
    expect(stream.addedBlocksByHash.size).toEqual(1);
  });

  it("does not call addBlock with fromSnapshot", () => {
    const addedBlocks = [];
    const stream = new EthStream(web3Provider, {
      fromSnapshot: [
        { hash: randomBlockHash(), number: 1, parentHash: randomBlockHash() }
      ],
      onAddBlock: block => addedBlocks.push(block)
    });
    expect(addedBlocks).toEqual([]);
  });

  it("fails when numConfirmations > streamSize", () => {
    const props = {
      numConfirmations: 4,
      streamSize: 3
    };
    expect(() => new EthStream(web3Provider, props)).toThrow();
  });
});

describe("addBlock", () => {
  beforeEach(() => {
    web3Provider = Ganache.provider();
    mineBlock = () => mineSingleBlock(web3Provider);
  });

  // For sharing variables
  let addedBlocks, confirmedBlocks, removedBlocks, getStream;

  beforeEach(() => {
    addedBlocks = [];
    confirmedBlocks = [];
    removedBlocks = [];
    getStream = (options = {}) =>
      new EthStream(web3Provider, {
        onAddBlock: block => addedBlocks.push(block.hash),
        onConfirmBlock: block => confirmedBlocks.push(block.hash),
        onRollbackBlock: block => removedBlocks.push(block.hash),
        numConfirmations: 2,
        streamSize: 3,
        ...options
      });
  });

  it("fails to add a fake block", async () => {
    const stream = getStream();
    await stream.promise("ready");
    stream.addBlock({
      hash: randomBlockHash(),
      number: 1,
      parentHash: randomBlockHash()
    });
    const error = await stream.promise("error");
    expect(error).toBeTruthy();
  });

  it("adds a new mined block", async () => {
    const stream = getStream();
    await stream.promise("ready");
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toContain(newBlock.hash);
  });

  it("adds parent blocks before child", async () => {
    const rootBlock = await mineBlock();
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    const stream = getStream({ streamSize: 2, numConfirmations: 1 });
    await stream.promise("ready");
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([
      rootBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  it("automatically adds the last streamSize blocks if no fromBlock is specified", async () => {
    const block1 = await mineBlock();
    const block2 = await mineBlock();
    const block3 = await mineBlock();
    const block4 = await mineBlock();
    const block5 = await mineBlock();
    const stream = getStream({ streamSize: 3 });
    await stream.promise("ready");
    stream.start();
    await stream.promise("live");
    expect(addedBlocks).toEqual([
      block2.hash,
      block3.hash,
      block4.hash,
      block5.hash
    ]);
  });

  it("fails to add block with invalid parent hash", async () => {
    const stream = getStream();
    await stream.promise("ready");
    const fromBlock = await mineBlock();
    await stream.addBlock(fromBlock);
    stream.addBlock({
      hash: randomBlockHash(),
      number: parseInt(fromBlock.number) + 1,
      parentHash: randomBlockHash()
    });
    const error = await stream.promise("error");
    expect(error).toBeTruthy();
  });

  it("adds new block and backfills to fromBlockNumber", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    const stream = getStream({ fromBlockNumber: parseInt(fromBlock.number) });
    await stream.promise("ready");
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    const promise = stream.addBlock(newBlock);
    await promise;
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  it("adds new block and backfills to fromBlockHash", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    const stream = getStream({ fromBlockHash: fromBlock.hash });
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock.hash,
      newBlock.hash
    ]);
  });

  it("adds new block and backfills to fromSnapshot", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = await mineBlock();
    const stream = getStream({ fromSnapshot: [fromBlock] });
    const parentBlock = await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(addedBlocks).toEqual([parentBlock.hash, newBlock.hash]);
  });

  it("rolls back false unconfirmed snapshotted blocks", async () => {
    await mineBlock(); // Make sure there is a block before fromBlock
    const fromBlock = Block.fromBlock(await mineBlock());
    const falseBlock1 = randomBlockHash();
    const falseBlock2 = randomBlockHash();
    const stream = getStream({
      streamSize: 2,
      numConfirmations: 1,
      fromSnapshot: [
        fromBlock,
        { ...fromBlock, hash: falseBlock1 },
        { ...fromBlock, hash: falseBlock2 }
      ]
    });
    await mineBlock();
    await mineBlock();
    await mineBlock();
    stream.addBlock(await mineBlock());
    await stream.promise("live");
    expect(removedBlocks).toEqual([falseBlock1, falseBlock2]);
  });

  it("adds new blocks asynchronously", async () => {
    const fromBlock = await genesisBlock();
    const stream = getStream();
    await stream.promise("ready");
    const parentBlock1 = await mineBlock();
    const parentBlock2 = await mineBlock();
    const newBlock = await mineBlock();
    stream.addBlock(newBlock);
    stream.addBlock(newBlock);
    await stream.promise("live");
    expect(addedBlocks).toEqual([
      fromBlock.hash,
      parentBlock1.hash,
      parentBlock2.hash,
      newBlock.hash
    ]);
  });

  it("confirms parent block", async () => {
    const fromBlock = await genesisBlock();
    const stream = getStream();
    await stream.promise("ready");
    await mineBlock();
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(confirmedBlocks).toEqual([fromBlock.hash]);
  });

  it("confirms parent blocks in order", async () => {
    const confirmBlock1 = await genesisBlock();
    const stream = getStream();
    await stream.promise("ready");
    const confirmBlock2 = await mineBlock();
    const parentBlock = await mineBlock();
    //await stream.addBlock(parentBlock);
    //expect(confirmedBlocks).toEqual([confirmBlock1.hash]);
    const newBlock = await mineBlock();
    await stream.addBlock(newBlock);
    expect(confirmedBlocks).toEqual([confirmBlock1.hash, confirmBlock2.hash]);
  });

  it("removes uncle block", async () => {
    const fromBlock = await genesisBlock();
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: fromBlock.hash
    };
    const stream = getStream({ streamSize: 4 });
    await stream.promise("ready");
    await stream.addBlock(uncleBlock);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(newBlock);
    expect(removedBlocks).toEqual([uncleBlock.hash]);
  });

  it("removes uncle blocks in order", async () => {
    const fromBlock = await genesisBlock();
    await mineBlock();
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock1 = {
      number: parseInt(newBlock.number) - 4,
      hash: randomBlockHash(),
      parentHash: fromBlock.hash
    };
    const uncleBlock2 = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: uncleBlock1.hash
    };
    const stream = getStream({ streamSize: 5 });
    await stream.promise("ready");
    await stream.addBlock(uncleBlock1);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(uncleBlock2);
    expect(removedBlocks).toEqual([]);
    await stream.addBlock(newBlock);
    expect(removedBlocks).toEqual([uncleBlock1.hash, uncleBlock2.hash]);
  });

  it("removes uncle block once when adding blocks asynchronously", async () => {
    const fromBlock = await genesisBlock();
    await mineBlock();
    await mineBlock();
    await mineBlock();
    const newBlock = await mineBlock();
    const uncleBlock = {
      number: parseInt(newBlock.number) - 3,
      hash: randomBlockHash(),
      parentHash: fromBlock.hash
    };
    const stream = getStream({ streamSize: 4 });
    await stream.promise("ready");
    await stream.addBlock(uncleBlock);
    await Promise.all([stream.addBlock(newBlock), stream.addBlock(newBlock)]);
    expect(removedBlocks).toEqual([uncleBlock.hash]);
  });

  fit("adds all old blocks, even if its many", async () => {
    const fromBlock = await genesisBlock();
    const hashes = [fromBlock.hash];

    for (let i = 0; i < 100; i++) {
      hashes.push((await mineBlock()).hash);
    }

    const stream = getStream({
      streamSize: 10,
      numConfirmations: 5,
      fromBlockHash: fromBlock.hash
    });
    const toBlock = await mineBlock();
    hashes.push(toBlock.hash);
    stream.addBlock(toBlock);
    await stream.promise("live");
    expect(addedBlocks).toEqual(hashes);

    for (let i = 0; i < 10; i++) {
      const newBlock = await mineBlock();
      hashes.push(newBlock.hash);
      await stream.addBlock(newBlock);
    }

    expect(addedBlocks).toEqual(hashes);
    expect(removedBlocks.length).toEqual(0);
  });
});
