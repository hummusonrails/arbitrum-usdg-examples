// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AcmeOracle
/// @notice Market prices pushed by Acme Perps' keeper, in USD with 8 decimals.
/// The margin vault refuses prices older than `maxAge`, so trading stops
/// rather than running on a stale price.
/// @dev Example code for learning the integration. It is unaudited and not
/// meant to hold real funds. A production perp would put Chainlink Data
/// Streams, Pyth, or its own signed prices behind this interface.
contract AcmeOracle is Ownable {
    struct Price {
        uint192 price;
        uint64 updatedAt;
    }

    uint256 public immutable maxAge;
    address public keeper;

    mapping(bytes32 => Price) private prices;

    event PricesUpdated(bytes32[] markets, uint256[] prices, uint256 updatedAt);
    event KeeperChanged(address indexed keeper);

    error NotKeeper();
    error UnknownMarket();
    error StalePrice();
    error LengthMismatch();
    error ZeroPrice();

    constructor(address owner_, address keeper_, uint256 maxAge_) Ownable(owner_) {
        keeper = keeper_;
        maxAge = maxAge_;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;

        emit KeeperChanged(keeper_);
    }

    function setPrices(bytes32[] calldata markets, uint256[] calldata newPrices) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (markets.length != newPrices.length) revert LengthMismatch();

        for (uint256 i; i < markets.length; i++) {
            if (newPrices[i] == 0) revert ZeroPrice();

            prices[markets[i]] = Price(uint192(newPrices[i]), uint64(block.timestamp));
        }

        emit PricesUpdated(markets, newPrices, block.timestamp);
    }

    /// @notice The last pushed price and when it was pushed, fresh or not.
    function latest(bytes32 market) external view returns (uint256 price, uint256 updatedAt) {
        Price memory p = prices[market];

        return (p.price, p.updatedAt);
    }

    /// @notice The price the vault trades at. Reverts when it is missing or stale.
    function priceOf(bytes32 market) external view returns (uint256) {
        Price memory p = prices[market];

        if (p.price == 0) revert UnknownMarket();
        if (block.timestamp - p.updatedAt > maxAge) revert StalePrice();

        return p.price;
    }
}
