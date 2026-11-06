# Household standard: schema card (household-standard/1)

Three things are original (evidence, judgement, setup); everything else is rebuilt. Sign: money in is positive; a card charge is negative. Money is integer cents. Absent means not stated, never zero. One economic fact is recognised once and cleared by every other witness.

## Observation kinds (what an importer emits)
txn_line: account_ref* posting_date* value_date description* amount_cents* balance_after_cents currency foreign_amount foreign_currency reference merchant_name card_member status date_basis
statement: account_ref* period_start* period_end* opening_cents* closing_cents* credits_cents debits_cents interest_cents fees_cents rate_pct due_on amount_due_cents minimum_due_cents
balance: account_ref* as_at* balance_cents* balance_kind available_cents sequence
payslip: person_ref* employer_ref* pay_date* period_start period_end gross_cents* tax_cents* net_cents* super_cents* salary_sacrifice_cents allowance_cents reimbursement_cents post_tax_deductions_cents ytd_gross_cents ytd_tax_cents ytd_super_cents account_ref plan_contribution_cents
income_statement: person_ref* employer_ref* fy* period_end* gross_cents* tax_cents* super_cents rfba_cents resc_cents allowance_cents finalised
loan_statement: account_ref* period_start* period_end* opening_cents* interest_cents* repayments_cents* fees_cents redraws_cents closing_cents* rate_pct offset_cents payout_cents payout_to_ref discharge_fee_cents
owner_statement: property_ref* period_start* period_end* gross_rent_cents* fees_cents* repairs_cents other_expenses_cents disbursed_cents* lines
super_statement: account_ref* period_start* period_end* opening_cents* closing_cents* employer_cents salary_sacrifice_cents personal_deductible_cents personal_after_tax_cents spouse_cents earnings_cents fees_cents insurance_cents tax_cents pension_cents withdrawal_cents
contract_note: account_ref* instrument_ref* side* trade_date* settlement_date units* price* brokerage_cents* consideration_cents* reference currency
holding: account_ref* instrument_ref* as_at* units* price value_cents acquired_on sellable_units currency
dividend: account_ref* instrument_ref* pay_date* units* franked_cents* unfranked_cents* franking_credit_cents* withholding_cents net_cents* drp_units drp_price attributed_later
distribution: account_ref* instrument_ref* fy* period_end* cash_cents* interest_cents franked_cents franking_credit_cents unfranked_cents foreign_income_cents foreign_credit_cents discount_gain_cents cgt_concession_cents tax_deferred_cents amit_increase_cents amit_decrease_cents
vest: plan_ref* person_ref* instrument_ref* vest_date* units* price* currency* fx_rate taxable_value_cents* account_ref withheld_units released_units status taxing_point_date cost_paid_cents cost_base_cents
crypto_txn: wallet_ref* time* type* asset* units* quote_asset quote_units aud_value_cents fee_asset fee_units txid
price: instrument_ref* as_at* price* currency*
fx_rate: base* quote* as_at* rate*
valuation: subject_ref* as_at* value_cents* method* valuer
policy: contract_ref* insurer_ref* policy_kind* period_start* period_end* premium_cents* sum_insured_cents excess_cents covers_ref paid_on
rate_notice: contract_ref* term* value* effective_on* notified_on
term_notice: subject_ref* term* value* valid_from* valid_to notified_on
bill: issuer_ref* bill_date* due_on period_start period_end amount_cents* gst_cents subject_ref reference
receipt: merchant_ref* date* total_cents* gst_cents items payment_ref
childcare_statement: provider_ref* child_ref* period_start* period_end* gross_fee_cents* subsidy_cents* gap_cents*
health_statement: person_ref* insurer_ref* fy* period_end* premium_cents* rebate_cents* days_covered* benefit_code
tax_assessment: person_ref* fy* assessed_on* lodged_on version* taxable_income_cents* gross_tax_cents* offsets_cents medicare_levy_cents mls_cents help_cents payg_credits_cents* other_credits_cents result_cents* labels
prefill: person_ref* fy* period_end* items*
help_balance: person_ref* as_at* balance_cents* indexation_cents repayment_cents
work_log: person_ref* fy* period_end* log_kind* hours km label amount_cents
depreciation_schedule: asset_ref* issued_on* items*
asset_fact: asset_ref* name* asset_kind* acquired_on* cost_cents serial warranty_until merchant_ref
settlement: asset_ref* settled_on* price_cents* duty_cents legal_cents other_costs_cents adjustments_cents loan_drawn_cents loan_ref cash_paid_cents side selling_costs_cents loan_payout_cents
corporate_action: instrument_ref* effective_on* action* ratio cash_per_unit_cents
super_line: account_ref* posting_date* line_type* description* amount_cents* balance_after_cents reference release_ref
ato_line: person_ref* posting_date* effective_date description* amount_cents* balance_after_cents fy reference ato_account role parent_ref
activity_statement: person_ref* period_start* period_end* instalment_cents varied due_on g1_cents gst_collected_cents gst_paid_cents g1_includes_gst gst_only
trust_statement: person_ref* trust_ref* fy* period_end* account_ref entitlement_cents* paid_on labels
ess_statement: person_ref* plan_ref* fy* period_end* discount_cents*
amortisation_schedule: contract_ref* issued_on* items*
super_tax_notice: person_ref* fy* assessed_on* amount_cents* due_on election

## Event kinds
opening_balance purchase refund income reimbursement gift_in transfer open_transfer wage wage_receipt wage_unmatched loan_interest loan_fee loan_payment loan_applied loan_redraw rent_statement rent_receipt super_contribution super_personal super_rollover super_earnings super_cost trade_buy trade_sell settle_cash dividend dividend_receipt drp cost_adjust corporate_action vest crypto_buy crypto_sell crypto_swap crypto_income revaluation asset_purchase asset_payment asset_disposal tax_assessed tax_refund tax_payment help_indexation adjustment on_behalf recovery super_withdrawal super_receipt trust_distribution bas_payment loss_carried cost_base_reset loan_payout capital_return ownership_change crypto_transfer div293_assessed super_release

## Tables
setup: household party membership account alias ownership link category instrument asset activity contract term period stream scope tax_map
evidence: source observation tax_return tax_line
judgement: decision rule recipe tailoring
plan: budget goal reservation scenario assumption
ledger: event witness posting lot lot_match balance
tax: tax_item
control: check_result review_item metric_value run

## Metrics
cash.income cash.spending cash.net cash.savings_rate budget.variance economic.income economic.expense income.receipts income.total income.taxable income.surcharge income.composition position.balance position.cash position.net_worth position.net_worth_by_group position.net_worth_by_owner position.free_cash loan.interest loan.principal_paid loan.rate_on loan.expected_interest activity.net_income property.cost_base super.contributions super.cap_used shares.holdings shares.realised_gain tax.item tax.estimate tax.readiness things.refresh_due bills.committed evidence.coverage forecast.cash forecast.tax advice.tax_return

## Laws
L1 Conservation; L2 Clearing; L3 Continuity; L4 One claim; L5 Payslip; L6 Interest; L7 Holdings; L8 Roll-forward; L9 Ownership; L10 Timeline; L11 Tax tie; L12 Seal; L13 Coverage; L14 Super tie; L15 Provenance; L16 Cap; L17 Bound; L18 One level; L19 BAS sales tie; L20 Plausibility
