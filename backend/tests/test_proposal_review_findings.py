"""Independent review counterexamples; pure valid model bodies."""
from workagent.proposal_review import removed_content
from workagent.flexible_models import StructuredTableBody
from workagent.product_models import TableBody

def test_decimal_replacement_containing_prior_digits_is_not_additive_text():
 before=StructuredTableBody(title='Measurements',fields=[{'key':'amount','label':'Amount','type':'decimal','scale':2,'editable':True}],rows=[{'row_id':'sample','cells':[{'field_key':'amount','value':'10.00'}]}])
 after=before.model_copy(deep=True);after.rows[0].cells[0].value='110.00'
 after=StructuredTableBody.model_validate(after.model_dump())
 assert removed_content(before,after)[1]==1

def test_metadata_named_user_column_is_not_authority_metadata():
 before=TableBody(title='Research annotations',source_csv='name,access_generation\na,Human qualification\n',rounding='ROUND_HALF_UP',columns=['name','access_generation'],rows=[{'name':'a','access_generation':'Human qualification'}],notes=[])
 after=before.model_copy(deep=True);after.rows[0]['access_generation']='Deleted and replaced'
 after=TableBody.model_validate(after.model_dump())
 assert removed_content(before,after)[1]==1
