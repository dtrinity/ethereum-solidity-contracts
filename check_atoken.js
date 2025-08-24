const { ethers } = require("hardhat");

async function main() {
  const aTokenAddress = "0x8353f5a7A51Aa5CcD16f645b1b4D54875F8cFA46";
  const aToken = await ethers.getContractAt("AToken", aTokenAddress);
  
  try {
    const name = await aToken.name();
    const symbol = await aToken.symbol();
    const decimals = await aToken.decimals();
    console.log("AToken details:");
    console.log("  Name:", name);
    console.log("  Symbol:", symbol);
    console.log("  Decimals:", decimals);
    
    // Check if it's been initialized
    if (name === "ATOKEN_IMPL" && symbol === "ATOKEN_IMPL") {
      console.log("✅ Token appears to be initialized with implementation values");
    } else if (name === "" && symbol === "") {
      console.log("❌ Token not initialized yet");
    } else {
      console.log("⚠️ Token has different values than expected");
    }
  } catch (error) {
    console.log("Error checking token:", error.message);
  }
}

main().catch(console.error);
