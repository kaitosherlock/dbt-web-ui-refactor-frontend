{{ config(materialized='table') }}

with order_payments as (
    select
        order_id,
        sum(case when payment_status = 'success' then amount else 0 end) as paid_amount
    from {{ ref('stg_payments') }}
    group by order_id
),

customer_activity as (
    select
        c.customer_id,
        c.first_name,
        c.last_name,
        count(distinct o.order_id) as order_count,
        coalesce(sum(p.paid_amount), 0) as lifetime_value,
        min(o.order_date) as first_order_date,
        max(o.order_date) as last_order_date
    from {{ ref('stg_customers') }} as c
    left join {{ ref('stg_orders') }} as o
        on c.customer_id = o.customer_id
    left join order_payments as p
        on o.order_id = p.order_id
    group by c.customer_id, c.first_name, c.last_name
)

select * from customer_activity
