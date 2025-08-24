const fs = require('fs');
const path = require('path');

// Read the artifact
const artifactPath = path.join(__dirname, 'artifacts/contracts/vaults/dloop/core/dlend/DLoopCoreDLend.sol/DLoopCoreDLend.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

console.log('Bytecode length:', artifact.bytecode.length);
console.log('Bytecode starts with:', artifact.bytecode.substring(0, 100));
console.log('Has valid 0x prefix:', artifact.bytecode.startsWith('0x'));

// Check if it's a placeholder bytecode
if (artifact.bytecode.includes('__')) {
  console.log('WARNING: Bytecode contains unlinked libraries (placeholders)');
  const matches = artifact.bytecode.match(/__\$[a-fA-F0-9]{34}\$__/g);
  if (matches) {
    console.log('Unlinked libraries found:', [...new Set(matches)]);
  }
}

// Check deployed bytecode
console.log('\nDeployed bytecode length:', artifact.deployedBytecode.length);
console.log('Deployed bytecode starts with:', artifact.deployedBytecode.substring(0, 100));
