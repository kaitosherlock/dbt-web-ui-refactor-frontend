{% macro e2e_echo(value) %}
  {{ log('E2E macro value: ' ~ value, info=True) }}
  {{ return(value) }}
{% endmacro %}

{% macro drop_e2e_schema(schema_name, database_name=none) %}
  {% set relation = api.Relation.create(
      database=(database_name if database_name is not none else target.database),
      schema=schema_name
  ) %}
  {% do adapter.drop_schema(relation) %}
{% endmacro %}
