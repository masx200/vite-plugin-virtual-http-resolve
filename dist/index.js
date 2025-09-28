import { createHash } from 'node:crypto';
import fse from 'fs-extra';
import { homedir } from 'node:os';
import path from 'node:path';
import axios from 'axios';

class FileCache {
  #cacheFolder;
  has(key) {
    const filepath = this.#getCachePath(key);
    return fse.exists(filepath);
  }
  constructor(cacheFolder) {
    this.#cacheFolder = path.join(homedir(), "cache", "fetch");
    if (cacheFolder) this.#cacheFolder = cacheFolder;
    fse.ensureDirSync(this.#cacheFolder);
  }
  #getCachePath(key) {
    const hash = createHash("sha512");
    hash.update(key);
    const filename = hash.digest("base64");
    return path.join(this.#cacheFolder, filename);
  }
  async set(key, value) {
    const filepath = this.#getCachePath(key);
    await fse.ensureFile(filepath);
    return await fse.writeFile(filepath, value, { encoding: "utf-8" });
  }
  async get(key) {
    const filepath = this.#getCachePath(key);
    if (!fse.exists(filepath)) {
      return;
    }
    await fse.ensureFile(filepath);
    return await fse.readFile(filepath, "utf-8");
  }
}
function isHttpVirtualProtocol(id) {
  return id?.startsWith("virtual:http://") || id?.startsWith("virtual:https://");
}
const cacheMemory =  new Map();
function remoteToLocal(options = {}) {
  const {
    cache = cacheMemory,
    fetcher = async (urlToFetch) => {
      const { data } = await axios.get(urlToFetch, {
        headers: {
          Accept: "application/javascript",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        }
      });
      return data;
    }
  } = options;
  function resolveId(id, importer) {
    if (importer?.startsWith("http://") || importer?.startsWith("https://")) {
      return null;
    }
    if (id.startsWith("http://") || id.startsWith("https://")) {
      return null;
    }
    if (isHttpVirtualProtocol(id)) {
      return id;
    }
    if (importer && isHttpVirtualProtocol(importer)) {
      const baseUrl = importer.replace("virtual:", "");
      if ((id.startsWith("/node/") || id.startsWith("/avsc@")) && id.endsWith(".mjs")) {
        const nodeModuleUrl = new URL(id, baseUrl);
        return "virtual:" + nodeModuleUrl.href;
      }
      if (id.startsWith("./chunk-") && id.endsWith(".mjs")) {
        const chunkUrl = new URL(id, baseUrl);
        return "virtual:" + chunkUrl.href;
      }
      if (id.startsWith("/-/") && id.includes("@")) {
        const resolvedUrl = new URL(id, baseUrl);
        return "virtual:" + resolvedUrl.href;
      }
      if (id.startsWith("./") || id.startsWith("../") || id.startsWith("/")) {
        const resolvedUrl = new URL(id, baseUrl);
        return "virtual:" + resolvedUrl.href;
      }
    }
    return null;
  }
  return {
    enforce: "pre",
    name: "virtual-http-resolve",
    resolveId(id, importer) {
      if (importer?.startsWith("virtual:https:/")) ;
      if (id.startsWith("virtual:https:/")) ;
      if (id.startsWith("virtual:https:/")) {
        id = id.replaceAll("virtual:https:/", "virtual:https://").replaceAll("virtual:https:///", "virtual:https://");
      }
      if (importer?.startsWith("virtual:https:/")) {
        importer = importer?.replaceAll("virtual:https:/", "virtual:https://").replaceAll("virtual:https:///", "virtual:https://");
      }
      const result = resolveId(id, importer);
      if (result) {
        if (result.startsWith("virtual:https:/")) {
          return result.replaceAll("virtual:https:/", "virtual:https://").replaceAll("virtual:https:///", "virtual:https://");
        }
        return result;
      }
      return null;
    },
    async load(id) {
      if (id.startsWith("virtual:https:/")) ;
      if (id.startsWith("virtual:https:/")) {
        id = id.replaceAll("virtual:https:/", "virtual:https://").replaceAll("virtual:https:///", "virtual:https://");
      }
      if (id.startsWith("http://") || id.startsWith("https://")) {
        return null;
      }
      if (!isHttpVirtualProtocol(id)) return null;
      if (await cache.has(id)) {
        return await cache.get(id);
      }
      let urlToFetch = id.replace("virtual:", "");
      try {
        let processedData = void 0;
        if (fetcher) {
          processedData = await fetcher(urlToFetch);
        } else {
          const { data } = await axios.get(urlToFetch, {
            headers: {
              Accept: "application/javascript",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
            }
          });
          processedData = data;
        }
        if (!processedData) {
          throw new Error(`No data fetched from ${urlToFetch}`);
        }
        if (id.includes("/node/")) {
          const nodeParts = id.split("/node/");
          if (nodeParts.length > 1) {
            const modulePart = nodeParts[1];
            if (modulePart) {
              const moduleNameParts = modulePart.split(".mjs");
              if (moduleNameParts.length > 0) {
                let moduleName = moduleNameParts[0];
                if (moduleName && moduleName.includes("chunk-")) {
                  moduleName = "chunk";
                }
                processedData = processedData.replace(
                  /var h=/g,
                  `var h_${moduleName}=`
                );
                if (!processedData) {
                  throw new Error(
                    `No data fetched from ${urlToFetch}`
                  );
                }
                processedData = processedData.replace(
                  /function h\(/g,
                  `function h_${moduleName}(`
                );
                processedData = processedData.replace(
                  /,h=/g,
                  `,h_${moduleName}=`
                );
              }
            }
          }
        }
        await cache.set(id, processedData);
        return processedData;
      } catch (error) {
        throw new Error(
          `Remote module load failed: ${urlToFetch}
` + String(error),
          { cause: error }
        );
      }
    }
  };
}

export { FileCache, remoteToLocal as default };
