export {
  createBrowserUseAdapter,
  DEFAULT_SIDECAR_URL,
  type BrowserUseAdapterConfig,
} from './adapter.js';
export { SidecarClient, type SidecarHealth } from './client.js';
export {
  parseSidecarResponse,
  sidecarRunResponseSchema,
  type SidecarRunRequest,
  type SidecarRunResponse,
} from './contract.js';
export { ADAPTER_NAME, sidecarProbe, toRunArtifact, type MapContext } from './map.js';
