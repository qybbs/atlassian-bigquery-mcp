import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { validateQuerySafety } from '../src/mcp';
import * as bigquery from '../src/bigquery';

describe('validateQuerySafety', () => {
  beforeAll(() => {
    // Setup environment variable for tests
    process.env.ALLOWLIST_TABLES = 'my_project.my_dataset.my_table,another_dataset.allowed_table';
  });

  afterEach(() => {
    // Clean up if necessary
  });

  it('harus mengizinkan query SELECT sederhana pada tabel yang terdaftar', () => {
    const sql = 'SELECT * FROM `my_dataset.my_table` LIMIT 10';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(true);
    expect(result.detectedTables).toContain('my_dataset.my_table');
  });

  it('harus mengizinkan query dengan klausa WITH (Common Table Expressions)', () => {
    const sql = 'WITH cte AS (SELECT * FROM `my_dataset.my_table`) SELECT * FROM cte';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(true);
    expect(result.detectedTables).toContain('my_dataset.my_table');
  });

  it('harus mendeteksi tabel dengan project ID', () => {
    const sql = 'SELECT * FROM `my_project.my_dataset.my_table`';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(true);
    // validateQuerySafety strips the project name and returns dataset.table
    expect(result.detectedTables).toContain('my_dataset.my_table');
  });

  it('harus menolak query non-SELECT (contoh: DELETE)', () => {
    const sql = 'DELETE FROM `my_dataset.my_table` WHERE id = 1';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Hanya query SELECT');
  });

  it('harus menolak tabel yang tidak terdaftar dalam allowlist', () => {
    const sql = 'SELECT * FROM `my_dataset.secret_table`';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('tidak terdaftar dalam allowlist');
  });

  it('harus menolak query yang mengandung keyword terlarang', () => {
    const sql = 'SELECT * FROM `my_dataset.my_table`; DROP TABLE `my_dataset.my_table`;';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('keyword terlarang: "drop"');
  });

  it('harus membersihkan komentar sehingga tabel/keyword tetap terdeteksi dengan benar', () => {
    const sql = `
      -- ini komentar palsu
      SELECT * 
      FROM \`my_dataset.my_table\`
      /* komentar drop table */
    `;
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(true);
    expect(result.detectedTables).toContain('my_dataset.my_table');
  });

  it('harus menggagalkan query yang menyisipkan keyword terlarang setelah komentar inline', () => {
    const sql = 'SELECT * FROM `my_dataset.my_table` -- komentar \n DROP TABLE `my_dataset.my_table`';
    const result = validateQuerySafety(sql);
    
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('keyword terlarang: "drop"');
  });
});
