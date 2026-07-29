import { parse } from "csv-parse/sync";
import { releaseWineMatchKey } from "@/lib/releaseOffers/parser";

export const CELLARTRACKER_PARSER_VERSION = "cellartracker-v3";
export const CELLARTRACKER_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const CELLARTRACKER_HEADERS = ["Color","Category","Size","Currency","Value","Price","TotalQuantity","Quantity","Pending","Vintage","Wine","Locale","Producer","Varietal","MasterVarietal","Designation","Vineyard","Country","Region","SubRegion","Appellation","BeginConsume","EndConsume","PScore","CScore"] as const;
export type CellarTrackerRow = { source_row_number:number; raw_row:Record<string,string>; match_status:"unmatched"|"invalid"; validation_errors:string[]; validation_warnings:string[]; source_wine:string; source_match_key:string; vintage:number|null; bottle_volume_ml:number; purchase_price_per_bottle_p:number|null; quantity_home:number; quantity_bbr:number; total_quantity:number; fully_consumed:boolean; colour:string|null; producer:string|null; country:string|null; region:string|null; appellation:string|null; varietal:string|null; begin_consume:number|null; end_consume:number|null };
export class CellarTrackerFileError extends Error { constructor(message:string) { super(message); this.name="CellarTrackerFileError"; } }
const text=(v:unknown)=>typeof v === "string" ? v.trim() : "";
const nullable=(v:unknown)=>text(v)||null;
function int(value:unknown, field:string, errors:string[], required=false):number|null { const v=text(value); if (!v) { if(required) errors.push(`${field} is required.`); return null; } if(!/^\d+$/.test(v)){errors.push(`${field} must be a whole number.`);return null;} return Number(v); }
/** CellarTracker can emit a per-bottle division with more than two decimals.
 * Preserve the source text in raw_row and store the comparison value rounded
 * to the nearest penny before any import validation depends on it. */
function price(value:unknown, errors:string[]):number|null { const v=text(value); if(!v)return null; if(!/^\d+(?:\.\d+)?$/.test(v)){errors.push("Price must be a non-negative GBP amount.");return null;} return Math.round(Number(v)*100); }
export function parseCellarTrackerCsv(csv:string):CellarTrackerRow[] {
 let records:Record<string,string>[];
 try { records=parse(csv,{columns:true,skip_empty_lines:true,bom:true,relax_column_count:false,trim:true}); } catch { throw new CellarTrackerFileError("The CellarTracker CSV could not be parsed."); }
 const headers=records[0] ? Object.keys(records[0]) : [];
 if (!CELLARTRACKER_HEADERS.every((header)=>headers.includes(header))) throw new CellarTrackerFileError("This is not the expected CellarTracker My Cellar CSV.");
 if (!records.length) throw new CellarTrackerFileError("The CellarTracker CSV has no data rows.");
 return records.map((raw_row,index)=>{
  const errors:string[]=[]; const warnings:string[]=[]; const wine=nullable(raw_row.Wine); if(!wine)errors.push("Wine is required.");
  const total=int(raw_row.TotalQuantity,"TotalQuantity",errors,true); const home=int(raw_row.Quantity,"Quantity",errors,true); const bbr=int(raw_row.Pending,"Pending",errors,true);
  if(total!==null&&home!==null&&bbr!==null&&total!==home+bbr) errors.push("TotalQuantity must equal Quantity plus Pending.");
  const size=text(raw_row.Size); if(size!=="750ml" && total!==0) errors.push("Only 750ml CellarTracker records are supported.");
  if(total===0 && size!=="(n/a)") warnings.push("Zero-total source rows normally use (n/a) size.");
  if(text(raw_row.Currency)!=="GBP") errors.push("CellarTracker prices must be GBP.");
  const sourceVintage=int(raw_row.Vintage,"Vintage",errors); const p=price(raw_row.Price,errors);
  if(total!==0 && p===null) errors.push("Price is required for a holding.");
  const beginConsume=int(raw_row.BeginConsume,"BeginConsume",errors); const endConsume=int(raw_row.EndConsume,"EndConsume",errors);
  return {source_row_number:index+1,raw_row,match_status:errors.length?"invalid":"unmatched",validation_errors:errors,validation_warnings:warnings,source_wine:wine??"",source_match_key:wine?releaseWineMatchKey(wine):"",vintage:sourceVintage,bottle_volume_ml:750,purchase_price_per_bottle_p:p,quantity_home:home??0,quantity_bbr:bbr??0,total_quantity:total??0,fully_consumed:total===0,colour:nullable(raw_row.Color),producer:nullable(raw_row.Producer),country:nullable(raw_row.Country),region:nullable(raw_row.Region),appellation:nullable(raw_row.Appellation),varietal:nullable(raw_row.Varietal),begin_consume:beginConsume,end_consume:endConsume};
 });
}
