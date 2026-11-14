/** Minimal Dataverse Web API client (fetch-based, no SDK). */
export interface DataverseClientOptions {
  /** e.g. https://contoso.crm4.dynamics.com */
  url: string;
  /** Returns a Dataverse access token for the current user (OBO). */
  getToken: () => Promise<string>;
  apiVersion?: string;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}

export class DataverseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DataverseError";
  }
}

export type Row = Record<string, unknown>;

export class DataverseClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DataverseClientOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/api/data/${options.apiVersion ?? "v9.2"}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.options.getToken();
    const res = await this.fetchImpl(path.startsWith("http") ? path : `${this.base}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: `odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500`,
        ...init.headers,
      },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new DataverseError(`Dataverse ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${body.slice(0, 300)}`, res.status);
    }
    return res;
  }

  /** GET a collection, following @odata.nextLink up to maxPages. */
  async list(entitySet: string, query: string): Promise<Row[]> {
    const rows: Row[] = [];
    let next: string | undefined = `${entitySet}?${query}`;
    for (let page = 0; next && page < (this.options.maxPages ?? 10); page++) {
      const res = await this.request(next);
      if (res.status === 404) throw new DataverseError(`Entity set not found: ${entitySet}`, 404);
      const body = (await res.json()) as { value: Row[]; "@odata.nextLink"?: string };
      rows.push(...body.value);
      next = body["@odata.nextLink"];
    }
    return rows;
  }

  /** Runs FetchXML against an entity set. */
  fetchXml(entitySet: string, fetchXml: string): Promise<Row[]> {
    return this.list(entitySet, `fetchXml=${encodeURIComponent(fetchXml)}`);
  }

  async get(entitySet: string, id: string, select: readonly string[]): Promise<Row | undefined> {
    const res = await this.request(`${entitySet}(${id})?$select=${select.join(",")}`);
    return res.status === 404 ? undefined : ((await res.json()) as Row);
  }

  /** PATCH = upsert by primary key. */
  async upsert(entitySet: string, id: string, body: Row): Promise<void> {
    await this.request(`${entitySet}(${id})`, { method: "PATCH", body: JSON.stringify(body) });
  }
}

/** OData string literal. */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
