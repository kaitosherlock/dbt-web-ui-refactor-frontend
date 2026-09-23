select customer_id
from {{ ref('customer_orders') }}
where order_count < 0 or lifetime_value < 0
