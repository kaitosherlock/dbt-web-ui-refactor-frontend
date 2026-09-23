{{ config(materialized='view') }}

select
    cast(id as bigint) as order_id,
    cast(user_id as bigint) as customer_id,
    cast(order_date as date) as order_date,
    cast(status as {{ dbt.type_string() }}) as order_status
from {{ ref('jaffle_shop_orders') }}
