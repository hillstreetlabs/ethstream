import crypto from "crypto";

export const randomBlockHash = () => {
  return `0x${crypto.randomBytes(64).toString("hex")}`;
};
