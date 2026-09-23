{{ config(materialized='view') }}

select
    cast(transaction_id as {{ dbt.type_string() }}) as transaction_id,
    cast(service_type as {{ dbt.type_string() }}) as service_type,
    cast(amount as decimal(18, 2)) as amount,
    cast(currency as {{ dbt.type_string() }}) as currency,
    cast(from_account as {{ dbt.type_string() }}) as from_account,
    cast(to_account as {{ dbt.type_string() }}) as to_account,
    cast(participant_code as {{ dbt.type_string() }}) as participant_code,
    cast(status as {{ dbt.type_string() }}) as transaction_status,
    cast(response_code as {{ dbt.type_string() }}) as response_code,
    cast(created_at as timestamp) as created_at
from {{ ref('transactions_batch1') }}
