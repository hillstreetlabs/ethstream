import { configure } from "mobx";
import EthStream from "./EthStream";

configure({ isolateGlobalState: true });

export default EthStream;
