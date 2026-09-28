import fs from 'node:fs'
import solc from 'solc'
const source = fs.readFileSync(new URL('../contracts/AuditRegistry.sol', import.meta.url),'utf8')
const input={language:'Solidity',sources:{'AuditRegistry.sol':{content:source}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}
const output=JSON.parse(solc.compile(JSON.stringify(input)))
for(const item of output.errors??[]) if(item.severity==='error')throw new Error(item.formattedMessage)
const artifact=output.contracts['AuditRegistry.sol'].AuditRegistry
fs.mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true})
fs.writeFileSync(new URL('./artifacts/AuditRegistry.json',import.meta.url),JSON.stringify({abi:artifact.abi,bytecode:artifact.evm.bytecode.object,compiler:solc.version()},null,2))
console.log('AuditRegistry compiled with',solc.version())
