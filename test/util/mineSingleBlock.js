import EthRpc from "ethjs-rpc";
import Web3 from "web3";

export default web3Provider => {
  const rpc = new EthRpc(web3Provider);
  const eth = new Web3(web3Provider).eth;

  return new Promise((resolve, reject) => {
    rpc.sendAsync(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        id: new Date().getTime()
      },
      async (err, result) => {
        if (err) return reject(err);
        const latest = await eth.getBlock("latest", true);
        resolve(latest);
      }
    );
  });
};
