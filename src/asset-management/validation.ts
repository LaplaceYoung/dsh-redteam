export class AssetManagementError extends Error {
  constructor(message:string,readonly status=400){super(message);this.name='AssetManagementError';}
}
export function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AssetManagementError('Expected JSON object');
  return Object.fromEntries(Object.entries(value));
}
export function textField(input:Record<string,unknown>,key:string,required=false):string|undefined {
  const value=input[key];
  if(value===undefined&&!required)return undefined;
  if(typeof value!=='string'||required&&!value.trim())throw new AssetManagementError(`${key} must be ${required?'a nonempty':'a'} string`);
  return value;
}
export function booleanField(input:Record<string,unknown>,key:string):boolean|undefined {
  const value=input[key];if(value!==undefined&&typeof value!=='boolean')throw new AssetManagementError(`${key} must be boolean`);return value;
}
export function numberField(input:Record<string,unknown>,key:string):number|undefined {
  const value=input[key];if(value!==undefined&&(typeof value!=='number'||!Number.isSafeInteger(value)))throw new AssetManagementError(`${key} must be an integer`);return value;
}
export function arrayField(input:Record<string,unknown>,key:string,required=false):unknown[]|undefined {
  const value=input[key];if(value===undefined&&!required)return undefined;if(!Array.isArray(value))throw new AssetManagementError(`${key} must be an array`);return value;
}
export function idsField(input:Record<string,unknown>,key:string,required=false):string[]|undefined {
  const value=arrayField(input,key,required);if(value===undefined)return undefined;
  return value.map(id=>{if(typeof id!=='string'||!id.trim())throw new AssetManagementError(`${key} must contain nonempty ID strings`);return id;});
}
