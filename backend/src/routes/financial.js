const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authGuard, adminOnly } = require('../middleware/auth');
const { hasDb } = require('../utils/db');

// Ensure table exists on load
async function ensureFinancialTable() {
  if (!(await hasDb())) return false;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS financial_records (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('income', 'expense') NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by BIGINT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status ENUM('approved', 'waiting_add', 'waiting_delete', 'rejected') NOT NULL DEFAULT 'approved',
        INDEX idx_fin_records_type (type),
        INDEX idx_fin_records_date (date)
      )
    `);

    // Ensure status column exists for older tables
    try {
      await pool.query("ALTER TABLE financial_records ADD COLUMN status ENUM('approved', 'waiting_add', 'waiting_delete', 'rejected') NOT NULL DEFAULT 'approved'");
    } catch (ignore) {}

    return true;
  } catch (e) {
    console.error('ensureFinancialTable error:', e.message);
    return false;
  }
}

async function ensureFinancialVisibilityTable() {
  if (!(await hasDb())) return false;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS financial_visibility_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        action ENUM('show', 'hide') NOT NULL,
        requested_by BIGINT NOT NULL,
        status ENUM('approved', 'waiting_approval', 'rejected') NOT NULL DEFAULT 'waiting_approval',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_by BIGINT NULL,
        approved_at TIMESTAMP NULL,
        INDEX idx_fin_vis_status (status)
      )
    `);

    // Insert default 'hide' approved row if table is empty
    const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM financial_visibility_logs');
    if (rows[0].cnt === 0) {
      // Find the first superadmin to set as creator
      const [admins] = await pool.query("SELECT id FROM accounts WHERE role = 'superadmin' LIMIT 1");
      const creatorId = admins.length > 0 ? admins[0].id : 1;
      await pool.query(
        "INSERT INTO financial_visibility_logs (action, requested_by, status) VALUES ('hide', ?, 'approved')",
        [creatorId]
      );
    }
    return true;
  } catch (e) {
    console.error('ensureFinancialVisibilityTable error:', e.message);
    return false;
  }
}

// Get unified query strings for reusability
const unifiedTransactionsSql = `
  SELECT 
    f.id, 
    f.type, 
    f.amount, 
    f.title, 
    f.description, 
    f.date, 
    'manual' AS source,
    a.full_name AS creator_name,
    f.status
  FROM financial_records f
  LEFT JOIN accounts a ON f.created_by = a.id

  UNION ALL

  SELECT 
    id, 
    'income' AS type, 
    amount, 
    CONCAT('ค่าส่วนกลางบ้าน ', COALESCE(house_number, 'ไม่ระบุ')) AS title, 
    paid_note AS description, 
    paid_at AS date, 
    'installment' AS source,
    NULL AS creator_name,
    'approved' AS status
  FROM payment_installments 
  WHERE status = 'paid' AND paid_at IS NOT NULL
`;

function registerFinancialRoutes(app) {
  ensureFinancialTable().catch(() => {});
  ensureFinancialVisibilityTable().catch(() => {});

  // 0. Get Visibility Status
  app.get('/financial/visibility', authGuard, async (req, res) => {
    try {
      const ok = await ensureFinancialVisibilityTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      // Get the latest approved status
      const [approvedRows] = await pool.query(
        "SELECT action FROM financial_visibility_logs WHERE status = 'approved' ORDER BY id DESC LIMIT 1"
      );
      const isVisible = approvedRows.length > 0 && approvedRows[0].action === 'show';

      let pendingRequest = null;
      if (req.user?.role === 'admin' || req.user?.role === 'superadmin') {
        const [pendingRows] = await pool.query(
          "SELECT * FROM financial_visibility_logs WHERE status = 'waiting_approval' ORDER BY id DESC LIMIT 1"
        );
        if (pendingRows.length > 0) {
          pendingRequest = pendingRows[0];
        }
      }

      return res.json({ ok: true, data: { isVisible, pendingRequest } });
    } catch (e) {
      console.error('GET /financial/visibility error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 0.1 Toggle Visibility Status (Admin/Superadmin)
  app.post('/financial/visibility/toggle', authGuard, adminOnly, async (req, res) => {
    try {
      const ok = await ensureFinancialVisibilityTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const { action } = req.body;
      if (!['show', 'hide'].includes(action)) {
        return res.status(400).json({ ok: false, error: 'INVALID_ACTION' });
      }

      const role = req.user?.role;
      let status = 'waiting_approval';
      let approvedBy = null;
      let approvedAt = null;

      // Check if there's already a pending request
      const [pendingRows] = await pool.query(
        "SELECT id FROM financial_visibility_logs WHERE status = 'waiting_approval' LIMIT 1"
      );
      if (pendingRows.length > 0) {
        return res.status(400).json({ ok: false, error: 'HAS_PENDING_REQUEST' });
      }

      if (role === 'superadmin') {
        status = 'approved';
        approvedBy = req.user.id;
        approvedAt = new Date();
      }

      const [result] = await pool.query(
        "INSERT INTO financial_visibility_logs (action, requested_by, status, approved_by, approved_at) VALUES (?, ?, ?, ?, ?)",
        [action, req.user.id, status, approvedBy, approvedAt]
      );

      return res.json({ ok: true, data: { id: result.insertId, status } });
    } catch (e) {
      console.error('POST /financial/visibility/toggle error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 0.2 Update Visibility Request Status (Superadmin only)
  app.patch('/financial/visibility/requests/:id/status', authGuard, async (req, res) => {
    try {
      if (req.user?.role !== 'superadmin') {
         return res.status(403).json({ ok: false, error: 'SUPERADMIN_ONLY' });
      }

      const id = Number(req.params.id);
      const { status } = req.body;

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
      }

      const [result] = await pool.query(
        "UPDATE financial_visibility_logs SET status = ?, approved_by = ?, approved_at = ? WHERE id = ? AND status = 'waiting_approval'",
        [status, req.user.id, new Date(), id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND_OR_NOT_PENDING' });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('PATCH /financial/visibility/requests/:id/status error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 0.3 Get Visibility Logs (Admin/Superadmin)
  app.get('/financial/visibility/logs', authGuard, adminOnly, async (req, res) => {
    try {
      const ok = await ensureFinancialVisibilityTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const [rows] = await pool.query(`
        SELECT 
          l.id, l.action, l.status, l.created_at, l.approved_at,
          r.username as requested_by_username, r.full_name as requested_by_name,
          a.username as approved_by_username, a.full_name as approved_by_name
        FROM financial_visibility_logs l
        LEFT JOIN accounts r ON l.requested_by = r.id
        LEFT JOIN accounts a ON l.approved_by = a.id
        ORDER BY l.id DESC
        LIMIT 50
      `);

      return res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('GET /financial/visibility/logs error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 1. Get Summary (Total Income, Total Expense, Balance)
  app.get('/financial/summary', authGuard, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
      const filterType = req.query.filter || 'all';

      let dateFilter = "WHERE status IN ('approved', 'waiting_delete')";
      if (filterType === 'month') {
        dateFilter += " AND date >= DATE_FORMAT(NOW() ,'%Y-%m-01')";
      } else if (filterType === 'week') {
        dateFilter += " AND date >= DATE_ADD(DATE(NOW()), INTERVAL - WEEKDAY(NOW()) DAY)";
      }

      const sql = `
        SELECT 
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense
        FROM (
          ${unifiedTransactionsSql}
        ) as t
        ${dateFilter}
      `;

      const [rows] = await pool.query(sql);
      const income = Number(rows[0]?.total_income || 0);
      const expense = Number(rows[0]?.total_expense || 0);
      const balance = income - expense;

      // Only return balance if admin
      const summary = {
        total_income: income,
        total_expense: expense,
      };
      
      if (isAdmin) {
        summary.balance = balance;
      }

      return res.json({ ok: true, data: summary });
    } catch (e) {
      console.error('GET /financial/summary error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 2. Get Transactions List
  app.get('/financial/transactions', authGuard, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';

      const filterType = req.query.filter || 'all'; // 'all', 'month', 'week'
      let dateFilter = isAdmin 
        ? "WHERE status IN ('approved', 'waiting_add', 'waiting_delete')" 
        : "WHERE status IN ('approved', 'waiting_delete')";

      if (filterType === 'month') {
        dateFilter += " AND date >= DATE_FORMAT(NOW() ,'%Y-%m-01')";
      } else if (filterType === 'week') {
        dateFilter += " AND date >= DATE_ADD(DATE(NOW()), INTERVAL - WEEKDAY(NOW()) DAY)";
      }

      const sql = `
        SELECT * FROM (
          ${unifiedTransactionsSql}
        ) as t
        ${dateFilter}
        ORDER BY date DESC
        LIMIT 200
      `;

      const [rows] = await pool.query(sql);
      return res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('GET /financial/transactions error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 3. Get Chart Data
  app.get('/financial/chart', authGuard, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const filterType = req.query.filter || 'month'; // 'month', 'week'
      let groupBy = '';
      let dateFilter = "WHERE status IN ('approved', 'waiting_delete')";
      
      if (filterType === 'month') {
        dateFilter += " AND date >= DATE_FORMAT(NOW() ,'%Y-%m-01')";
        groupBy = 'DATE(date)';
      } else { // week
        dateFilter += " AND date >= DATE_ADD(DATE(NOW()), INTERVAL - WEEKDAY(NOW()) DAY)";
        groupBy = 'DATE(date)';
      }

      const sql = `
        SELECT 
          ${groupBy} as label,
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
        FROM (
          ${unifiedTransactionsSql}
        ) as t
        ${dateFilter}
        GROUP BY ${groupBy}
        ORDER BY ${groupBy} ASC
      `;

      const [rows] = await pool.query(sql);
      return res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('GET /financial/chart error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 4. Add Record (Admin/SuperAdmin)
  app.post('/financial/records', authGuard, adminOnly, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const { type, amount, title, description, date } = req.body;
      
      if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({ ok: false, error: 'INVALID_TYPE' });
      }
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT' });
      }
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ ok: false, error: 'INVALID_TITLE' });
      }

      const recordDate = date ? new Date(date) : new Date();
      
      let status = 'approved';
      if (type === 'expense' && req.user?.role !== 'superadmin') {
        status = 'waiting_add';
      }

      const [result] = await pool.query(
        `INSERT INTO financial_records (type, amount, title, description, date, created_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [type, Number(amount), title, description || null, recordDate, req.user?.id || null, status]
      );

      return res.status(201).json({ ok: true, data: { id: result.insertId, status } });
    } catch (e) {
      console.error('POST /financial/records error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 5. Delete Record (Admin/SuperAdmin)
  app.delete('/financial/records/:id', authGuard, adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'INVALID_ID' });

      let result;
      let status = 'deleted';
      
      if (req.user?.role === 'superadmin') {
         [result] = await pool.query('DELETE FROM financial_records WHERE id = ?', [id]);
      } else {
         [result] = await pool.query('UPDATE financial_records SET status = ? WHERE id = ?', ['waiting_delete', id]);
         status = 'waiting_delete';
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      return res.json({ ok: true, data: { status } });
    } catch (e) {
      console.error('DELETE /financial/records error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 6. Export Records (Admin/SuperAdmin)
  app.get('/financial/export', authGuard, adminOnly, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const filterType = req.query.filter || 'all'; // 'all', 'month', 'week'
      let dateFilter = "WHERE status IN ('approved', 'waiting_delete')";
      if (filterType === 'month') {
        dateFilter += " AND date >= DATE_FORMAT(NOW() ,'%Y-%m-01')";
      } else if (filterType === 'week') {
        dateFilter += " AND date >= DATE_ADD(DATE(NOW()), INTERVAL - WEEKDAY(NOW()) DAY)";
      }

      const sql = `
        SELECT * FROM (
          ${unifiedTransactionsSql}
        ) as t
        ${dateFilter}
        ORDER BY date DESC
      `;

      const [rows] = await pool.query(sql);

      // Create CSV header
      let csvContent = '\uFEFF'; // BOM for UTF-8
      csvContent += 'วันที่,ประเภท,รายการ,จำนวนเงิน (บาท),แหล่งที่มา\n';
      const lines = [];

      for (const row of rows) {
        const d = new Date(row.date);
        const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getFullYear()+543} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        
        let typeStr = row.type === 'income' ? 'รายรับ' : 'รายจ่าย';
        let amountStr = Number(row.amount).toFixed(2);
        let titleStr = '"' + (row.title || '').replace(/"/g, '""') + '"';
        let sourceStr = row.source === 'installment' ? 'ระบบค่างวด' : 'บันทึกเอง';

        lines.push(`${dateStr},${typeStr},${titleStr},${amountStr},${sourceStr}`);
      }

      const csv = csvContent + lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="financial_export.csv"');
      return res.send(csv);
    } catch (e) {
      console.error('GET /financial/export error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 7. Get Waiting Approvals (SuperAdmin/Admin)
  app.get('/financial/waiting-approval', authGuard, adminOnly, async (req, res) => {
    try {
      const ok = await ensureFinancialTable();
      if (!ok) return res.status(500).json({ ok: false, error: 'DB_NOT_READY' });

      const sql = `
        SELECT * FROM (
          ${unifiedTransactionsSql}
        ) as t
        WHERE status IN ('waiting_add', 'waiting_delete')
        ORDER BY date DESC
      `;

      const [rows] = await pool.query(sql);
      return res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('GET /financial/waiting-approval error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });

  // 8. Update Status (SuperAdmin only)
  app.patch('/financial/records/:id/status', authGuard, async (req, res) => {
    try {
      if (req.user?.role !== 'superadmin') {
         return res.status(403).json({ ok: false, error: 'SUPERADMIN_ONLY' });
      }
      
      const id = Number(req.params.id);
      const { status } = req.body;
      
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'INVALID_ID' });
      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
      }

      // Check current status
      const [rows] = await pool.query('SELECT status FROM financial_records WHERE id = ?', [id]);
      if (rows.length === 0) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      
      const currentStatus = rows[0].status;
      
      if (status === 'approved') {
        if (currentStatus === 'waiting_add') {
           await pool.query('UPDATE financial_records SET status = ? WHERE id = ?', ['approved', id]);
        } else if (currentStatus === 'waiting_delete') {
           await pool.query('DELETE FROM financial_records WHERE id = ?', [id]);
        } else {
           return res.status(400).json({ ok: false, error: 'INVALID_STATE_TRANSITION' });
        }
      } else if (status === 'rejected') {
        if (currentStatus === 'waiting_add') {
           await pool.query('UPDATE financial_records SET status = ? WHERE id = ?', ['rejected', id]);
        } else if (currentStatus === 'waiting_delete') {
           await pool.query('UPDATE financial_records SET status = ? WHERE id = ?', ['approved', id]);
        } else {
           return res.status(400).json({ ok: false, error: 'INVALID_STATE_TRANSITION' });
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('PATCH /financial/records/:id/status error:', e);
      return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
    }
  });
}

module.exports = { registerFinancialRoutes };
