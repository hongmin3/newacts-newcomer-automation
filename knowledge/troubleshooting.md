# Troubleshooting

## Configuration invariants
<!-- akela: id=config-invariants scope=attendance,education,registration,deploy tier=must -->
`active`, `mode`, 운영 수신자, Sheet ID·이름·열 위치, trigger 함수명을 오류 증거 없이 변경하지 않는다.

## Test-name warning
<!-- akela: id=test-name-warning scope=attendance,education,registration tier=must -->
`run*Test`라는 함수명만으로 안전한 TEST mode라고 판단하지 않는다. 실제 실행 전 README의 mode와 수신자 안전 절차를 확인한다.

## Personal data
<!-- akela: id=personal-data scope=all tier=must -->
개인 명단, Sheet 식별자, 메일 수신자, 실행 결과, `.clasp` 인증 정보를 Knowledge·Evidence·응답·Git에 복사하지 않는다.
