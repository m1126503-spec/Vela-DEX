import { handleChainstackRpcRequest } from '../server/chainstackRpc.js';

export default async function handler(request, response) {
  const result = await handleChainstackRpcRequest({
    method: request.method,
    body: request.body
  });
  response
    .status(result.status)
    .setHeader('Cache-Control', 'no-store')
    .json(result.body);
}
