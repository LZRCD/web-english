import {
  DATA_ASSET_HASHES,
  DATA_CONTENT_VERSION,
  DICTIONARY_RANGE_INDEX as GENERATED_DICTIONARY_RANGE_INDEX,
} from "./data-versions.generated.ts";
import type { DictionaryRangeIndex } from "./dictionary-range.ts";

export const DICTIONARY_RANGE_INDEX =
  GENERATED_DICTIONARY_RANGE_INDEX as DictionaryRangeIndex;

export { DATA_ASSET_HASHES, DATA_CONTENT_VERSION };

/** 为本地数据 URL 附加内容哈希，数据升级后自动绕过旧浏览器缓存。 */
export function versionedDataUrl(assetPath: string) {
  const hash = DATA_ASSET_HASHES[assetPath];
  if (!hash) return assetPath;
  return `${assetPath}${assetPath.includes("?") ? "&" : "?"}v=${hash.slice(0, 16)}`;
}
