{{
    config(
        materialized='incremental',
        incremental_strategy='merge',
        unique_key='transaction_id',
        tags=['e2e_incremental']
    )
}}

select
    transaction_id,
    service_type,
    amount,
    currency,
    from_account,
    to_account,
    participant_code,
    transaction_status,
    response_code,
    created_at
from {{ ref('stg_transactions') }}
where amount >= cast({{ var('minimum_amount', 0) }} as decimal(18, 2))
{% if is_incremental() %}
  and created_at > (
      select coalesce(max(created_at), cast('1900-01-01' as timestamp)) from {{ this }}
  )
{% endif %}
