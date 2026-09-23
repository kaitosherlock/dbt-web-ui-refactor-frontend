{{ config(materialized='view') }}

select
    cast(id as bigint) as payment_id,
    cast(orderid as bigint) as order_id,
    cast(paymentmethod as {{ dbt.type_string() }}) as payment_method,
    cast(status as {{ dbt.type_string() }}) as payment_status,
    cast(amount as decimal(18, 2)) / 100.0 as amount,
    cast(created as date) as created_date
from {{ ref('stripe_payments') }}
