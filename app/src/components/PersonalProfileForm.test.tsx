import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomerProfile } from '../types'
import PersonalProfileForm from './PersonalProfileForm'

afterEach(cleanup)

describe('PersonalProfileForm 现有档案行为', () => {
  it('性别门禁、同一 next 回传与最终完整 profile 提交', () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    render(
      <PersonalProfileForm
        initial={{ nickname: '测试昵称' }}
        onSubmit={onSubmit}
        onChange={onChange}
      />,
    )

    const submitButton = screen.getByRole('button', { name: '✨ 生成个人形象分析' })
    expect((submitButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(submitButton)
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '👩女' }))
    expect((submitButton as HTMLButtonElement).disabled).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as CustomerProfile
    expect(next).toMatchObject({ nickname: '测试昵称', gender: '女' })
    expect(screen.getByRole('button', { name: '👩女' }).classList.contains('active')).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('请输入您的昵称'), {
      target: { value: '界面新昵称' },
    })
    const latest = onChange.mock.calls.at(-1)?.[0] as CustomerProfile
    expect(latest).toMatchObject({ nickname: '界面新昵称', gender: '女' })
    expect((screen.getByPlaceholderText('请输入您的昵称') as HTMLInputElement).value).toBe(
      latest.nickname,
    )

    fireEvent.click(submitButton)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(latest)
  })

  it('用户未编辑时，晚到的 initial 能回填', () => {
    const { rerender } = render(<PersonalProfileForm onSubmit={vi.fn()} />)
    expect(
      (screen.getByRole('button', { name: '✨ 生成个人形象分析' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    rerender(
      <PersonalProfileForm initial={{ nickname: '晚到昵称', gender: '女' }} onSubmit={vi.fn()} />,
    )

    expect((screen.getByPlaceholderText('请输入您的昵称') as HTMLInputElement).value).toBe(
      '晚到昵称',
    )
    expect(
      (screen.getByRole('button', { name: '✨ 生成个人形象分析' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('用户已编辑后，晚到的 initial 不覆盖界面', () => {
    const { rerender } = render(<PersonalProfileForm onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('请输入您的昵称'), {
      target: { value: '用户先输入' },
    })

    rerender(
      <PersonalProfileForm initial={{ nickname: '晚到昵称', gender: '女' }} onSubmit={vi.fn()} />,
    )

    expect((screen.getByPlaceholderText('请输入您的昵称') as HTMLInputElement).value).toBe(
      '用户先输入',
    )
    expect(
      (screen.getByRole('button', { name: '✨ 生成个人形象分析' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('清除生日时同时清空日期和时辰，并把同一 next 交给 onChange', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PersonalProfileForm
        initial={{ gender: '女', birth_date: '1995-05-20', birth_hour: '午时' }}
        onSubmit={vi.fn()}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '填错了？清除' }))
    const next = onChange.mock.calls.at(-1)?.[0] as CustomerProfile
    expect(next).toMatchObject({ gender: '女', birth_date: '', birth_hour: '' })
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('时辰（先填日期）')).toBeTruthy()
  })
})
