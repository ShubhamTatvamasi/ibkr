import directory from '../data/assets.json';
import type { EntityOverrides } from './export/pack';

/** A publicly documented issuer record, curated in src/data/assets.json. */
export interface AssetRecord {
  isin: string;
  symbols: string[];
  name: string;
  issuer: string;
  nature: string;
  country: string;
  address: string;
  zip: string;
  sources: { label: string; url: string }[];
  verified: string;
}

export const ASSETS = directory as AssetRecord[];

const byIsin = new Map(ASSETS.map((a) => [a.isin.toUpperCase(), a]));

export function findAsset(isin?: string): AssetRecord | undefined {
  return isin ? byIsin.get(isin.toUpperCase()) : undefined;
}

export interface Entity {
  name: string;
  address: string;
  zip: string;
  nature?: string;
  /** Where the address came from. */
  source: 'you' | 'address book' | 'missing';
  record?: AssetRecord;
}

/** Your own entries win, then the address book, then IBKR's short name with no address. */
export function entityFor(symbol: string, isin: string | undefined, ibkrName: string, overrides: EntityOverrides): Entity {
  const own = overrides[symbol] ?? {};
  const rec = findAsset(isin);
  const address = own.address?.trim() || rec?.address || '';
  return {
    name: own.name?.trim() || rec?.name || ibkrName,
    address,
    zip: own.zip?.trim() || rec?.zip || '',
    nature: rec?.nature,
    source: own.address?.trim() ? 'you' : rec ? 'address book' : 'missing',
    record: rec,
  };
}
