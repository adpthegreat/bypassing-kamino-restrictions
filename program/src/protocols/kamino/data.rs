use pinocchio::program_error::ProgramError;

pub struct KaminoInitData {
    pub mode: u8,
}

impl TryFrom<&[u8]> for KaminoInitData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self { mode: data[0] })
    }
}

pub struct KaminoActionData {
    pub amount: u64,
    pub flags: u8,
}

impl TryFrom<&[u8]> for KaminoActionData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 9 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            flags: data[8],
        })
    }
}
