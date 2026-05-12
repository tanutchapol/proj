# NitiSmart Database Mapping Table (Data Dictionary)

## Table: `accounts`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `username` | VARCHAR(64) | NOT NULL UNIQUE, |
| `password_hash` | VARCHAR(255) | NOT NULL, |
| `full_name` | VARCHAR(255) | NULL, |
| `phone` | VARCHAR(30) | NULL, |
| `role` | ENUM('user', 'admin', 'superadmin') | NOT NULL DEFAULT 'user', |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP |


## Table: `users`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | VARCHAR(64) | NOT NULL PRIMARY KEY, |
| `amount` | DECIMAL(10,2) | NOT NULL DEFAULT 0.00, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NULL DEFAULT CURRENT_TIMESTAMP |


## Table: `residents`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `house_number` | VARCHAR(32) | NOT NULL UNIQUE, |
| `title` | VARCHAR(16) | NULL, |
| `first_name` | VARCHAR(128) | NOT NULL, |
| `last_name` | VARCHAR(128) | NULL, |
| `phone` | VARCHAR(32) | NULL, |
| `household_count` | INT | NOT NULL DEFAULT 1, |
| `car_count` | INT | NOT NULL DEFAULT 0, |
| `pay_months` | INT | NULL, |
| `account_id` | BIGINT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NULL DEFAULT NULL, |


## Table: `houses`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | INT | AUTO_INCREMENT PRIMARY KEY, |
| `house_number` | VARCHAR(32) | NOT NULL UNIQUE, |
| `owner_name` | VARCHAR(128) | NULL, |
| `area_sq_m` | DECIMAL(10,2) | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP |


## Table: `payments`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | INT | AUTO_INCREMENT PRIMARY KEY, |
| `house_id` | INT | NULL, |
| `house_number` | VARCHAR(32) | NOT NULL UNIQUE, |
| `area_sq_m` | DECIMAL(10,2) | NULL, |
| `rate_per_sqm` | DECIMAL(10,2) | NOT NULL DEFAULT 10.00, |
| `months` | INT | NOT NULL DEFAULT 0, |
| `amount_per_month` | DECIMAL(12,2) | NOT NULL DEFAULT 0, |
| `total_amount` | DECIMAL(12,2) | NOT NULL DEFAULT 0, |
| `note` | VARCHAR(255) | NULL, |
| `cover_until` | TIMESTAMP | NULL, |
| `pay_status` | ENUM('paid', 'pending', 'overdue', 'waiting_approval') | NOT NULL DEFAULT 'overdue', |
| `remaining_days` | INT | NOT NULL DEFAULT 0, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `payment_installments`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `payment_id` | INT | NOT NULL, |
| `house_number` | VARCHAR(32) | NOT NULL, |
| `installment_no` | INT | NOT NULL, |
| `months_span` | INT | NOT NULL, |
| `due_date` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `amount` | DECIMAL(12,2) | NOT NULL, |
| `status` | ENUM('paid', 'pending', 'overdue', 'waiting_approval') | NOT NULL DEFAULT 'pending', |
| `paid_at` | TIMESTAMP | NULL, |
| `period_start` | DATE | NULL, |
| `period_end` | DATE | NULL, |
| `paid_method` | ENUM('cash', 'promptpay', 'bank_transfer') | NULL, |
| `paid_note` | VARCHAR(255) | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `payment_intents`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `installment_id` | BIGINT | NULL, |
| `payment_id` | INT | NULL, |
| `house_number` | VARCHAR(32) | NULL, |
| `amount` | DECIMAL(12,2) | NOT NULL, |
| `method` | ENUM('cash', 'promptpay', 'bank_transfer') | NOT NULL DEFAULT 'promptpay', |
| `status` | ENUM('initiated', 'pending', 'confirmed', 'failed', 'expired') | NOT NULL DEFAULT 'initiated', |
| `qr_id` | VARCHAR(255) | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `slipok_verifications`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `amount` | DECIMAL(12,2) | NULL, |
| `qrcode_data` | TEXT | NULL, |
| `sending_bank` | VARCHAR(128) | NULL, |
| `sender_name` | VARCHAR(255) | NULL, |
| `trans_date` | CHAR(8) | NULL, |
| `trans_time` | CHAR(8) | NULL, |
| `slip_datetime` | DATETIME | NULL, |
| `paid_at` | DATETIME | NULL, |
| `raw_json` | TEXT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `announcements`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `title` | VARCHAR(255) | NOT NULL, |
| `date` | VARCHAR(32) | NOT NULL, |
| `image` | VARCHAR(1024) | NULL, |
| `description` | TEXT | NULL, |
| `important` | BOOLEAN | NOT NULL DEFAULT FALSE, |
| `created_by` | BIGINT | NULL, |
| `updated_by` | BIGINT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NULL DEFAULT NULL, |


## Table: `contacts`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `title` | VARCHAR(255) | NOT NULL, |
| `number` | VARCHAR(64) | NOT NULL, |
| `created_by` | BIGINT | NULL, |
| `updated_by` | BIGINT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |
| `updated_at` | TIMESTAMP | NULL DEFAULT NULL, |


## Table: `repairs`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | VARCHAR(32) | NOT NULL PRIMARY KEY, |
| `user_id` | BIGINT | NOT NULL, |
| `title` | VARCHAR(255) | NOT NULL, |
| `detail` | TEXT | NULL, |
| `house_number` | VARCHAR(32) | NULL, |
| `status` | ENUM('pending', 'in_progress', 'done') | NOT NULL DEFAULT 'pending', |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `repair_photos`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `repair_id` | VARCHAR(32) | NOT NULL, |
| `url` | VARCHAR(1024) | NOT NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_rooms`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `name` | VARCHAR(255) | NOT NULL, |
| `room_type` | ENUM('public', 'dm') | NOT NULL, |
| `owner_id` | BIGINT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_members`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `room_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `role` | ENUM('member', 'admin') | NOT NULL DEFAULT 'member', |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_messages`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `room_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `text` | TEXT | NULL, |
| `msg_type` | ENUM('text', 'image', 'file') | NOT NULL DEFAULT 'text', |
| `file_url` | VARCHAR(1024) | NULL, |
| `file_name` | VARCHAR(512) | NULL, |
| `file_size` | BIGINT | NULL, |
| `mime_type` | VARCHAR(255) | NULL, |
| `reply_to_id` | BIGINT | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_room_reads`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `room_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `last_read_message_id` | BIGINT | NULL, |
| `last_read_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_room_pins`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `room_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `pinned_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_room_admin_pins`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `room_id` | BIGINT | NOT NULL, |
| `pinned_by` | BIGINT | NULL, |
| `pinned_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_message_pins`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `message_id` | BIGINT | NOT NULL, |
| `room_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `pinned_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `chat_reactions`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `message_id` | BIGINT | NOT NULL, |
| `user_id` | BIGINT | NOT NULL, |
| `emoji` | VARCHAR(16) | NOT NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `system_settings`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `key` | VARCHAR(64) | PRIMARY KEY, |
| `value` | TEXT | NOT NULL, |
| `is_encrypted` | BOOLEAN | DEFAULT FALSE, |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP, |
| `updated_by` | BIGINT | NULL, |


## Table: `resident_logs`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `action` | VARCHAR(32) | NOT NULL,            -- 'create', 'update', 'delete', 'update_months' |
| `resident_id` | BIGINT | NULL, |
| `house_number` | VARCHAR(32) | NULL, |
| `resident_name` | VARCHAR(255) | NULL, |
| `changes` | JSON | NULL,                      -- { field: { old, new } } |
| `performed_by` | BIGINT | NULL, |
| `performed_by_name` | VARCHAR(255) | NULL, |
| `performed_by_role` | VARCHAR(32) | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `repair_edit_logs`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `repair_id` | INT | NOT NULL, |
| `action` | VARCHAR(32) | NOT NULL,            -- 'edit', 'status_change' |
| `changes` | JSON | NULL,                      -- { field: { old, new } } |
| `performed_by` | BIGINT | NULL, |
| `performed_by_name` | VARCHAR(255) | NULL, |
| `performed_by_role` | VARCHAR(32) | NULL, |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |


## Table: `announcement_logs`
| Column Name | Data Type | Attributes/Constraints |
|---|---|---|
| `id` | BIGINT | AUTO_INCREMENT PRIMARY KEY, |
| `action` | VARCHAR(32) | NOT NULL, |
| `announcement_id` | INT | , |
| `announcement_title` | TEXT | , |
| `changes` | JSON | , |
| `performed_by` | BIGINT | , |
| `performed_by_name` | VARCHAR(255) | , |
| `performed_by_role` | VARCHAR(32) | , |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP, |

