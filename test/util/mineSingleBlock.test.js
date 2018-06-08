import Ganache from "ganache-core";
import Web3 from "web3";
import mineSingleBlock from "./mineSingleBlock";

const web3Provider = Ganache.provider();
const eth = new Web3(web3Provider).eth;

describe("mineSingleBlock", () => {
  test("succeeds", async () => {
    const block = await mineSingleBlock(web3Provider);
    expect(block).toBeTruthy();
  });

  test("updates block number", async () => {
    const blockNumber = parseInt(await eth.blockNumber());
    await mineSingleBlock(web3Provider);
    const newBlockNumber = parseInt(await eth.blockNumber());
    expect(newBlockNumber).toEqual(blockNumber + 1);
  });

  test("updates latest block", async () => {
    const block = await eth.getBlock("latest", true);
    await mineSingleBlock(web3Provider);
    const newBlock = await eth.getBlock("latest", true);
    expect(newBlock.hash).not.toEqual(block.hash);
  });

  test("returns new block", async () => {
    const newBlock = await mineSingleBlock(web3Provider);
    const latestBlock = await eth.getBlock("latest", true);
    expect(newBlock.hash).toEqual(latestBlock.hash);
  });
});
