import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-ignition-ethers';
import "@nomicfoundation/hardhat-verify";
import dotenv from 'dotenv';

dotenv.config();

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.28',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: false,
        },
    },
    networks: {
        hardhat: {
            loggingEnabled: false,
        },
        SoneiumTestnet: {
            url: process.env.SONEIUM_TESTNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
        SoneiumMainnet: {
            url: process.env.SONEIUM_MAINNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
    },
    // Blockscout verification (native support in @nomicfoundation/hardhat-verify v2.1+).
    // No apiKey needed. Etherscan is disabled because Soneium uses Blockscout-based
    // explorers; leaving it enabled (the default) would make `verify` exit with an
    // error for these networks even when Blockscout verification succeeds.
    etherscan: {
        enabled: false,
    },
    blockscout: {
        enabled: true,
        customChains: [
            {
                network: "SoneiumMainnet",
                chainId: 1868,
                urls: {
                    apiURL: "https://soneium.blockscout.com/api",
                    browserURL: "https://soneium.blockscout.com",
                },
            },
            {
                network: "SoneiumTestnet",
                chainId: 1946,
                urls: {
                    apiURL: "https://soneium-minato.blockscout.com/api",
                    browserURL: "https://soneium-minato.blockscout.com",
                },
            },
        ],
    },
    sourcify: {
        enabled: true,
    },
};

export default config;
