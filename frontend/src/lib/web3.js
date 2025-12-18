import { ethers } from "ethers";
import axios from "axios";
import { BACKEND_URL } from "./config.js";

export async function requireMetaMask() {
  if (!window.ethereum) throw new Error("MetaMask not detected");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export async function fetchContracts() {
  const { data } = await axios.get(`${BACKEND_URL}/contracts`);
  return data;
}

export async function loadContract(abi, address, signerOrProvider) {
  return new ethers.Contract(address, abi, signerOrProvider);
}

export async function fetchAbi(name) {
  const { data } = await axios.get(`${BACKEND_URL}/abi/${name}`);
  return data; // mảng ABI
}