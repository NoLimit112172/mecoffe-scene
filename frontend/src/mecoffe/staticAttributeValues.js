// Display labels for known CFPS codes. Source values are preserved by the data adapter.
export const STATIC_ATTRIBUTE_VALUES = Object.freeze({
  gender: {male:'男', female:'女'},
  age_group: {'18_24':'18—24 岁','25_34':'25—34 岁','35_44':'35—44 岁','45_59':'45—59 岁','60_plus':'60 岁及以上'},
  urban_context: {urban:'城镇', rural:'乡村'},
  education_status: {
    student_junior_secondary:'在读初中', student_upper_secondary_combined:'在读高中／中专／职高／技校',
    student_associate:'在读大专', student_bachelor:'在读本科', student_master:'在读硕士', student_doctorate:'在读博士',
    completed_no_literacy:'文盲／半文盲', completed_primary:'小学', completed_junior_secondary:'初中',
    completed_upper_secondary_combined:'高中／中专／职高／技校', completed_associate:'大专', completed_bachelor:'本科',
    completed_master:'硕士', completed_doctorate:'博士',
  },
  employment_category: {student:'在校生',manager:'负责人／管理人员',professional_technical:'专业技术人员',clerical:'办事人员',
    commerce_service:'商业／服务业人员',agriculture:'农林牧渔水利生产人员',production_transport:'生产／运输设备操作人员',
    military:'军人',other:'其他职业',unemployed:'失业',outside_labor_force:'退出劳动力市场／非经济活动人口'},
  household_income_band: {under_10k:'家庭人均年收入不足 1 万元','10k_30k':'家庭人均年收入 1 万至不足 3 万元',
    '30k_60k':'家庭人均年收入 3 万至不足 6 万元','60k_100k':'家庭人均年收入 6 万至不足 10 万元','100k_plus':'家庭人均年收入 10 万元及以上'},
  wechat_sharing: {no_wechat:'未使用微信',never:'使用微信但从不分享',monthly_or_less:'每月 2—3 次及以下',weekly:'每周 1—4 次',daily:'几乎每天'},
  shopping_frequency_week: {no_shopping:'过去一周没有网购',some_days:'过去一周有网购，但非每天',almost_daily:'过去一周每天／几乎每天网购'},
  shortvideo_week: {yes:'是',no:'否'},
  mindset_orientation: {fixed_leaning:'偏固定型',mixed:'混合型',growth_leaning:'偏发展型'},
  sleep_hours_band: {under_6:'不足 6 小时','6_under8':'6 至不足 8 小时','8_plus':'8 小时及以上'},
  exercise_frequency_code: {'1':'平均每月不足 1 次','2':'平均每月 1 次以上、每周不足 1 次','3':'平均每周 1—2 次',
    '4':'平均每周 3—4 次','5':'平均每周 5 次及以上','6':'每天 1 次','7':'每天 2 次及以上','8':'从不参加'},
})

export function displayStaticAttributeValue(key, value) {
  if (Array.isArray(value)) return value.map(item => displayStaticAttributeValue(key, item))
  const values = Object.hasOwn(STATIC_ATTRIBUTE_VALUES, key) ? STATIC_ATTRIBUTE_VALUES[key] : null
  if (values && Object.hasOwn(values, String(value))) return values[String(value)]
  if (['stranger_trust_score','social_reputation_score'].includes(key) && /^\d+$/.test(String(value)) && Number(value) <= 10) {
    return `${value} 分（0—10 分）`
  }
  return value
}
