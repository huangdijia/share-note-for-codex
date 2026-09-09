# Share Note · 样式验收

同一份内容，四种阅读方式。This bilingual article checks readable typography, spacing, links, tables and code on desktop and narrow screens.

## 项目进展 / Project notes

这是中文段落，用来检查系统字体、自动换行和行距。**重要信息**与*补充说明*都应保持清晰；访问 [示例链接](https://example.com/docs) 查看链接样式。Inline `contentHash` should remain legible.

- 简洁：日常分享与团队沟通。
- 技术：代码、接口、表格与排查记录。
- 阅读：长文与知识整理。
- 深色：正文阅读区域的深色外观。

### 验收顺序

1. 先预览正文与样式。
2. 核对内容哈希和目标记录。
3. 获得发布授权后再上传。

> 主题与正文一起加密，预览与发布使用相同片段。
> This quote should retain a clear boundary and comfortable contrast.

## 宽表格 / Wide table

| 模块 Module | 行为 Behavior | 输入 Input | 输出 Output | 状态 Status | 长字段 Long field |
| --- | --- | --- | --- | --- | --- |
| Preview | Sanitized article | Markdown / HTML | Encrypted-ready fragment | Verified locally | very_long_identifier_without_breaks_abcdefghijklmnopqrstuvwxyz_0123456789 |
| Update | Preserve theme | Existing record | Same record and key | Mock verified | another_long_identifier_without_breaks_abcdefghijklmnopqrstuvwxyz_0123456789 |

## 长代码 / Long code

```typescript
const publication = { title: '中英文分享', theme: 'technical', description: 'This deliberately long line should scroll only inside the code block instead of widening the article or entire page.' };
function contentMatches(expected: string, actual: string): boolean {
  return expected === actual;
}
```

---

结束语：正文外的服务界面保持原有外观。The article ends here.
