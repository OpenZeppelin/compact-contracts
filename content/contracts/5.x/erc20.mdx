---
title: ERC-20
---

An ERC-20 token contract keeps track of [_fungible_ tokens](./tokens#different-kinds-of-tokens): any one token is exactly equal to any other token; no tokens have special rights or behavior associated with them. This makes ERC-20 tokens useful for things like a **medium of exchange currency**, **voting rights**, **staking**, and more.

OpenZeppelin Contracts provides many ERC20-related contracts. On the [`API reference`](/contracts/5.x/api/token/ERC20) you’ll find detailed information on their properties and usage.

## Constructing an ERC-20 Token Contract

Using Contracts, we can easily create our own ERC-20 token contract, which will be used to track _Gold_ (GLD), an internal currency in a hypothetical game.

Here’s what our GLD token might look like.

<include cwd lang='solidity'>./examples/token/ERC20/GLDToken.sol</include>

Our contracts are often used via [inheritance](https://solidity.readthedocs.io/en/latest/contracts.html#inheritance), and here we’re reusing [`ERC20`](/contracts/5.x/api/token/ERC20#erc20) for both the basic standard implementation and the [`name`](/contracts/5.x/api/token/ERC20#ERC20-name--), [`symbol`](/contracts/5.x/api/token/ERC20#ERC20-symbol--), and [`decimals`](/contracts/5.x/api/token/ERC20#ERC20-decimals--) optional extensions. Additionally, we’re creating an `initialSupply` of tokens, which will be assigned to the address that deploys the contract.

<Callout>
For a more complete discussion of ERC-20 supply mechanisms, see [Creating ERC-20 Supply](./erc20-supply).
</Callout>

That’s it! Once deployed, we will be able to query the deployer’s balance:

```javascript
> GLDToken.balanceOf(deployerAddress)
1000000000000000000000
```

We can also [transfer](/contracts/5.x/api/token/ERC20#IERC20-transfer-address-uint256-) these tokens to other accounts:

```javascript
> GLDToken.transfer(otherAddress, 300000000000000000000)
> GLDToken.balanceOf(otherAddress)
300000000000000000000
> GLDToken.balanceOf(deployerAddress)
700000000000000000000
```

## A Note on `decimals`

Often, you’ll want to be able to divide your tokens into arbitrary amounts: say, if you own `5 GLD`, you may want to send `1.5 GLD` to a friend, and keep `3.5 GLD` to yourself. Unfortunately, Solidity and the EVM do not support this behavior: only integer (whole) numbers can be used, which poses an issue. You may send `1` or `2` tokens, but not `1.5`.

To work around this, [`ERC20`](/contracts/5.x/api/token/ERC20#ERC20) provides a [`decimals`](/contracts/5.x/api/token/ERC20#ERC20-decimals--) field, which is used to specify how many decimal places a token has. To be able to transfer `1.5 GLD`, `decimals` must be at least `1`, since that number has a single decimal place.

How can this be achieved? It’s actually very simple: a token contract can use larger integer values, so that a balance of `50` will represent `5 GLD`, a transfer of `15` will correspond to `1.5 GLD` being sent, and so on.

It is important to understand that `decimals` is _only used for display purposes_. All arithmetic inside the contract is still performed on integers, and it is the different user interfaces (wallets, exchanges, etc.) that must adjust the displayed values according to `decimals`. The total token supply and balance of each account are not specified in `GLD`: you need to divide by `10 ** decimals` to get the actual `GLD` amount.

You’ll probably want to use a `decimals` value of `18`, just like Ether and most ERC-20 token contracts in use, unless you have a very special reason not to. When minting tokens or transferring them around, you will be actually sending the number `num GLD * (10 ** decimals)`.

<Callout>
By default, `ERC20` uses a value of `18` for `decimals`. To use a different value, you will need to override the `decimals()` function in your contract.
</Callout>

```solidity
function decimals() public view virtual override returns (uint8) {
  return 16;
}
```

So if you want to send `5` tokens using a token contract with 18 decimals, the method to call will actually be:

```solidity
transfer(recipient, 5 * (10 ** 18));
```
