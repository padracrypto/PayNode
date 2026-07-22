export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const ESCROW_ADDRESS = "0x835393bCaa40d1e8B8D585567D17E38FdF8ABAc8";

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address recipient, uint256 amount) external returns (bool)"
];

export const ESCROW_ABI = [
  "function fundEscrow(uint256 _projectId, address _builder, uint256 _amount) external",
  "function deliverWork(uint256 _projectId) external",
  "function releasePayment(uint256 _projectId) external",
  "function mutualCancel(uint256 _projectId) external"
];