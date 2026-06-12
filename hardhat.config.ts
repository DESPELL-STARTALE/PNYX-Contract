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
        localhost: {
            url: process.env.LK_TESTNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
        SoneiumTestnet: {
            url: process.env.SONEIUM_TESTNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
        SoneiumMainnet: {
            url: process.env.SONEIUM_MAINNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
        EthSepoliaTestnet: {
            url: process.env.ETH_SEPOLIA_TESTNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        },
        BaseSepoliaTestnet: {
            url: process.env.BASE_SEPOLIA_TESTNET_PROVIDER_URL,
            accounts: [process.env.PRIVATE_KEY || '']
        }
    },
    etherscan: {
        apiKey: {
            // Blockscout does not actually require an apiKey,
            // so any non-empty string works
            SoneiumMainnet: "empty",
        },
        customChains: [
            {
                network: "SoneiumMainnet",
                chainId: 1868,
                urls: {
                    apiURL: "https://soneium.blockscout.com/api",
                    browserURL: "https://soneium.blockscout.com",
                },
            },
        ],
    },
    sourcify: {
        enabled: true
    },
};

export default config;
