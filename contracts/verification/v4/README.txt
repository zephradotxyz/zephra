Zephra v4 source verification (Elysium mainnet, chain 99901)
Compiler solc 0.8.26, viaIR true, EVM cancun, license MIT

ZephraTokenV4
  address 0x3976B4427F3e5064f0222f60c84A1dA0F535D6B2
  contract contracts/v4/ZephraTokenV4.sol:ZephraTokenV4
  optimizer runs 200
  input verification/v4/ZephraTokenV4.standard-input.json
  constructor args (hex, no 0x): (none)
  bytecode matches deployed: true

Create2Deployer
  address 0x43815Ca62654313Dfa355dE3f8a8986b614E4611
  contract contracts/v4/V4Support.sol:Create2Deployer
  optimizer runs 200
  input verification/v4/Create2Deployer.standard-input.json
  constructor args (hex, no 0x): (none)
  bytecode matches deployed: true

ZephraConfig
  address 0x21DC69A011404BF667988169e528DDf22e563796
  contract contracts/ZephraConfig.sol:ZephraConfig
  optimizer runs 200
  input verification/v4/ZephraConfig.standard-input.json
  constructor args (hex, no 0x): 00000000000000000000000011341c88bbf32ff62741324d7b533cb65dbf215900000000000000000000000000ff4a225bc94724da0286df8d5fc8b00ffb35de000000000000000000000000b51ab221225470514985d931fa948d7e1a43071e00000000000000000000000000000000000000000000000542253a126ce4000000000000000000000000000000000000000000000000000000b1a2bc2ec50000
  bytecode matches deployed: true

ZephraPoolViewFactory
  address 0x92bE66d06a3D8c7Be5f01E00150A0A41D46A509A
  contract contracts/v4/ZephraPoolView.sol:ZephraPoolViewFactory
  optimizer runs 200
  input verification/v4/ZephraPoolViewFactory.standard-input.json
  constructor args (hex, no 0x): (none)
  bytecode matches deployed: true

MarketFactory
  address 0x16c898FCAb0935DAf101f6d34aF4F90971155aaA
  contract contracts/PerpMarket.sol:MarketFactory
  optimizer runs 200
  input verification/v4/MarketFactory.standard-input.json
  constructor args (hex, no 0x): 00000000000000000000000021dc69a011404bf667988169e528ddf22e563796
  bytecode matches deployed: false

ZephraV4Launchpad
  address 0x009557496762b804b28C3D051318Aee2b8a8AACC
  contract contracts/v4/ZephraV4Launchpad.sol:ZephraV4Launchpad
  optimizer runs 200
  input verification/v4/ZephraV4Launchpad.standard-input.json
  constructor args (hex, no 0x): 000000000000000000000000e2e105d3f7209a9da11f83ccf3e7398a753823f100000000000000000000000021dc69a011404bf667988169e528ddf22e56379600000000000000000000000016c898fcab0935daf101f6d34af4f90971155aaa00000000000000000000000092be66d06a3d8c7be5f01e00150a0a41d46a509a0000000000000000000000003976b4427f3e5064f0222f60c84a1da0f535d6b2
  bytecode matches deployed: false

ZephraRouter
  address 0x4c104E998E5024aBB2a098D4dE1fcf01cc8D43d4
  contract contracts/v4/ZephraRouter.sol:ZephraRouter
  optimizer runs 200
  input verification/v4/ZephraRouter.standard-input.json
  constructor args (hex, no 0x): 000000000000000000000000e2e105d3f7209a9da11f83ccf3e7398a753823f1000000000000000000000000009557496762b804b28c3d051318aee2b8a8aacc
  bytecode matches deployed: false

ZephraQuoter
  address 0xAfc50B0208576D486C5AfA767C182AD0617B939f
  contract contracts/v4/ZephraQuoter.sol:ZephraQuoter
  optimizer runs 200
  input verification/v4/ZephraQuoter.standard-input.json
  constructor args (hex, no 0x): 000000000000000000000000009557496762b804b28c3d051318aee2b8a8aacc
  bytecode matches deployed: false

