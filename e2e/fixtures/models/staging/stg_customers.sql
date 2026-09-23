{{ config(materialized='view') }}

select
    cast(id as bigint) as customer_id,
    cast(first_name as {{ dbt.type_string() }}) as first_name,
    cast(last_name as {{ dbt.type_string() }}) as last_name
from {{ ref('jaffle_shop_customers') }}
