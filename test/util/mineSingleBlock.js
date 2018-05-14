import EthRpc from "ethjs-rpc";
import Eth from "ethjs";

export default web3Provider => {
  const rpc = new EthRpc(web3Provider);
  const eth = new Eth(web3Provider);

  return new Promise((resolve, reject) => {
    rpc.sendAsync(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        id: new Date().getTime()
      },
      async (err, result) => {
        if (err) return reject(err);
        const latest = await eth.getBlockByNumber("latest", true);
        resolve(latest);
      }
    );
  });
};
